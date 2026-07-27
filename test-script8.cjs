const { GoogleGenAI } = require('@google/genai');
async function test() {
  const ai = new GoogleGenAI({ 
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
  });
  
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
