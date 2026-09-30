// Frontend configuration for diJastipinaraa
// The deployed Google Apps Script Web App is the only product-data source.

const config = {
  // Apps Script Web App URL (required)
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxPy67HECTXhSf_sN2tgB3DCkgmLdXdoQ9t3B4g8PaJWsFSNairwoFmZSJbUEBCRpvt/exec',
  
  // Fallback WhatsApp number for when catalog hasn't loaded yet
  WA_NUMBER_FALLBACK: '',
  
  DEV_MOCK: false
};

// Export for use in app.js
window.config = config;
