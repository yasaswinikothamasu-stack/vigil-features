import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();
// connect to your MongoDB deployment

async function run() {
const client = new MongoClient(process.env.DB_URL);
  try {
    const database = client.db("test");
    const collection = database.collection("senderstats");
   
    // Define your MongoDB Vector Search index
    const index = {
        name: "vector_index",
        type: "vectorSearch",
        definition: {
          "fields": [
            {
              "type": "vector",
              "path": "embedding",
              "similarity": "dotProduct",
              "numDimensions": 768
            }
          ]
        }
    }

    // Call the method to create the index
    const result = await collection.createSearchIndex(index);
    console.log(result);
  } finally {
    await client.close();
  }
}
run().catch(console.dir);
