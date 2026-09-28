// Frontend configuration for diJastipinaraa
// Replace APPS_SCRIPT_URL with your deployed Apps Script web app URL
// Set DEV_MOCK to true for local development with mock data

const config = {
  // Apps Script Web App URL (required)
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec',
  
  // Fallback WhatsApp number for when catalog hasn't loaded yet
  WA_NUMBER_FALLBACK: '',
  
  // Enable mock data for development (uses dev-mock/catalog.json and card-catalogue photos)
  DEV_MOCK: false,
  
  // Local development server URL (for mock data)
  DEV_SERVER_URL: 'http://localhost:8080'
};

// Export for use in app.js
window.config = config;