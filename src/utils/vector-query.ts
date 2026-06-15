import { MongoClient } from 'mongodb';
import { getEmbedding } from "./embeddings";
import dotenv from 'dotenv';
dotenv.config();
// MongoDB connection URI and options
const client = new MongoClient(process.env.DB_URL);
async function run() {
    try {
        // Connect to the MongoDB client
        await client.connect();

        // Specify the database and collection
        const database = client.db("test"); 
        const collection = database.collection("senderstats"); 

        // Generate embedding for the search query
        const queryEmbedding = await getEmbedding("Personal loan up to 10 lakhs on Tata Neu, 100 percent digital and zero hassle");

        // Define the sample vector search pipeline
        const pipeline = [
            {
                $vectorSearch: {
                    index: "vector_index",
                    queryVector: queryEmbedding,
                    path: "embedding",
                    exact: true,
                    limit: 5
                }
            },
            {
                $project: {
                    _id: 0,
                    lastSubject:1,
                    score: {
                        $meta: "vectorSearchScore"
                    }
                }
            }
        ];

        // run pipeline
        const result = collection.aggregate(pipeline);

        // print results
        for await (const doc of result) {
            console.dir(JSON.stringify(doc));
        }
        } finally {
        await client.close();
    }
}
run().catch(console.dir);