import { MongoClient ,ObjectId} from "mongodb";
import { getEmbedding } from "../utils/embeddings";
import ollama from "ollama";

export async function searchSimilarMessagesInternal(
  query: string,
  ownerUserId: string,
  limit = 5
) {
  const client = new MongoClient(process.env.DB_URL!);

  try {
    await client.connect();

    const db = client.db("statAlert");
    const collection = db.collection("senderstats");

    // Generate embedding for user query
    const queryEmbedding = await getEmbedding(query);
    console.log(queryEmbedding,"queryEmbedding");

    const results = await collection
      .aggregate([
        {
          $vectorSearch: {
            index: "vector_index",
            path: "embedding",
            queryVector: queryEmbedding,
            numCandidates: 100,
            limit,
          },
        },
        {
          $match: {
            ownerUserId: new ObjectId(ownerUserId),
          },
        },
        {
          $project: {
            senderName: 1,
            senderEmail: 1,
            senderCategory: 1,
            lastSubject: 1,
            emailCount: 1,
            unreadCount: 1,
            score: {
              $meta: "vectorSearchScore",
            },
          },
        },
      ])
      .toArray();
      console.log(results,"results");

    return results;
  } finally {
    await client.close();
  }
}


export async function askOllama(prompt: string) {
  const response = await ollama.chat({
    model: "llama3.1:8b",
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  return response.message.content;
}