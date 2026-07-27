const { GoogleGenAI } = require('@google/genai');
const { GoogleAuth } = require('google-auth-library');

async function test() {
  const auth = new GoogleAuth();
  
  // Create an auth client that just returns the token from GEMINI_API_KEY
  const client = {
    getRequestHeaders: async () => {
      return { 'Authorization': `Bearer ${process.env.GEMINI_API_KEY}` };
    }
  };
  auth.getClient = async () => client;

  const original = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  const ai = new GoogleGenAI({ 
    auth: auth
  });

  process.env.GEMINI_API_KEY = original;
  
  try {
    const res = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: 'hello'
    });
    console.log("Success:", res.text);
  } catch (err) {
    console.log("Error:", err.message);
  }
}
test();
