export function cleanJSON(text: string): any {
  // remove code fences
  let cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();

  // try to extract the first {...} block
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    console.error("No JSON found in model output:", text);
    return {};
  }

  try {
    return JSON.parse(match[0]);
  } catch (err) {
    console.error("Failed to parse JSON:", match[0], err);
    return {};
  }
}