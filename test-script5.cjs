const { GoogleGenAI } = require('@google/genai');
async function test() {
  const token = process.env.GEMINI_API_KEY;
  const original = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  
  const ai = new GoogleGenAI({ 
    httpOptions: { 
      headers: { 
        'Authorization': `Bearer ${token}` 
      }
    }
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
