import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config();
// Set up OpenAI configuration
import { GoogleGenerativeAI } from "@google/generative-ai";


// export async function getEmbedding(text) {

//     const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
//     const results = await openai.embeddings.create({
//         model: "text-embedding-3-small",
//         input: text,
//         encoding_format: "float",
//     });
//     return results.data[0].embedding;
// }




export async function getEmbedding(text: string) {
    console.log("hiii",text);
  const genAI = new GoogleGenerativeAI(process.env.GEMINIAI_API_KEY!);

  const model = genAI.getGenerativeModel({
    model: "text-embedding-004",
  });

  const result = await model.embedContent(text);
  console.log(result,'result');
  console.log(result.embedding.values,'embedding values');

  return result.embedding.values;
}

