const { GoogleGenAI } = require('@google/genai');
async function test() {
  const ai = new GoogleGenAI({ apiKey: 'AIzaSy' + 'A'.repeat(33) });
  try {
    const res = await ai.models.generateContent({ model: 'gemini-3.6-flash', contents: 'hello' });
    console.log("Success:", res.text);
  } catch (err) {
    console.log("Error:", err.message);
  }
}
test();
