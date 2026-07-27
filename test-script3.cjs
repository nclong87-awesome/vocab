const { GoogleGenAI } = require('@google/genai');
async function test() {
  const ai = new GoogleGenAI({ vertexai: { project: process.env.GOOGLE_CLOUD_PROJECT || "test", location: "us-central1" } });
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
