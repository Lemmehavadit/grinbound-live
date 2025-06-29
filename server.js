const express = require('express');
const { google } = require('googleapis');
const { VertexAI } = require('@google-cloud/vertexai');
const { formatInTimeZone } = require('date-fns-tz');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// --- Configuration ---
const SPREADSHEET_ID = '1MmVNjOuBtMWRJWo2AiO7tjvRcymxZAYzjY_cDugiasw';
const KEY_FILE_PATH = path.join(__dirname, 'css/service-account-key.json');
const PROJECT_ID = 'gen-lang-client-0124181838';
const LOCATION = 'us-central1';
const TIME_ZONE = 'America/Chicago'; // CST

// --- API Clients ---
const auth = new google.auth.GoogleAuth({
  keyFile: KEY_FILE_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });
const vertex_ai = new VertexAI({ project: PROJECT_ID, location: LOCATION });
const model = vertex_ai.getGenerativeModel({ model: 'gemini-1.0-pro' });

// --- Helper function for Gemini Analysis ---
async function getGeminiAnalysis(message) {
  const prompt = `Analyze the following message from a website contact form. First, determine if a response is necessary (e.g., it asks a question). Second, provide a one-sentence summary of a suggested response. Format the output strictly as "[Yes/Maybe/No]: [Suggested response summary]". Message: "${message}"`;
  
  try {
    const result = await model.generateContent(prompt);
    const response = result.response;
    return response.candidates[0].content.parts[0].text;
  } catch (error) {
    console.error('Error calling Gemini API:', error);
    return 'Maybe: AI analysis failed.';
  }
}

// --- Endpoint to handle contact form submission ---
app.post('/submit-contact-form', async (req, res) => {
  const { name, email, message, isParent, schoolName, grade, subscribe } = req.body;
  
  const now = new Date();
  const formattedTimestamp = formatInTimeZone(now, TIME_ZONE, 'MM/dd/yyyy h:mm a');

  try {
    const geminiResponse = await getGeminiAnalysis(message);
    
    // --- Main "Contact Us" Sheet ---
    const contactSheetRow = [
      formattedTimestamp,          // A: Date and Time
      name,                        // B: Respondant's Name
      email,                       // C: Listed Return Email Address
      message,                     // D: Submitted Message
      '',                          // E: My Reply (initially empty)
      schoolName || '',            // F: Child's School
      grade || '',                 // G: Grade
      geminiResponse               // H: Further Correspondance Neccessary
    ];
    
    const contactSheetPromise = sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Contact Us!A1',
      valueInputOption: 'USER_ENTERED',
      resource: { values: [contactSheetRow] },
    });

    // --- "Mailing List" Sheet if subscribed ---
    let mailingListPromise = Promise.resolve();
    if (subscribe) {
      const mailingListRow = [
        formattedTimestamp,          // A: Initial Date and Time
        name,                        // B: Respondant's Name
        email,                       // C: Listed Return Email Address
        message,                     // D: Previously Submitted Message
        '',                          // E: My Past Reply (initially empty)
        schoolName || '',            // F: Child's School
        grade || '',                 // G: Grade
        geminiResponse               // H: Custom Correspondance Neccessary
      ];
      mailingListPromise = sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Mailing List!A1',
        valueInputOption: 'USER_ENTERED',
        resource: { values: [mailingListRow] },
      });
    }

    await Promise.all([contactSheetPromise, mailingListPromise]);
    res.status(200).json({ success: true, message: 'Form submitted successfully.' });

  } catch (error) {
    console.error('Error processing form:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error.' });
  }
});

const PORT = 5002;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
