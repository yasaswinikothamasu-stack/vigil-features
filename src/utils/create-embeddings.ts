import { MongoClient } from 'mongodb';
import { getEmbedding } from './embeddings';
// import { convertEmbeddingsToBSON } from './convert-embeddings.js';
import dotenv from 'dotenv';
dotenv.config();
export const run = async function run() {

    // Connect to your MongoDB deployment
    let client;
    try {
         console.log(process.env.DB_URL,"aaaa");
         client = new MongoClient(process.env.DB_URL);
        // console.log(client,'client');
        await client.connect();
        const db = client.db("test");
        const collection = db.collection("senderstats");
        // console.log(collection,'collection');

        // Filter to exclude null or empty summary fields
        // const filter = { "summary": { "$nin": [ null, "" ] } };

        // Get a subset of documents from the collection
        const documents = await collection.find().limit(50).toArray();
        console.log(`Fetched ${documents.length} documents for embedding generation.`);
        console.log(documents,'documents');

        console.log("Generating embeddings and updating documents...");
        const updateDocuments = [];
        await Promise.all(documents.map(async doc => {

            // Generate an embedding using the function that you defined
            var embedding = await getEmbedding(doc.lastSubject);

            // Uncomment the following lines to convert the generated embedding into BSON format
            // const bsonEmbedding = await convertEmbeddingsToBSON([embedding]); // Since convertEmbeddingsToBSON is designed to handle arrays
            // embedding = bsonEmbedding; // Use BSON embedding instead of the original float32 embedding
             
            // Add the embedding to an array of update operations
            updateDocuments.push(
                {
                    updateOne: { 
                        filter: { "_id": doc._id },
                        update: { $set: { "embedding": embedding } }
                    }
                }
           )
       }));

       // Continue processing documents if an error occurs during an operation
       const options = { ordered: false };

       // Update documents with the new embedding field
    //    const result = await collection.bulkWrite(updateDocuments, options); 
    //    console.log("Count of documents updated: " + result.modifiedCount); 
            
    } catch (err) {
        console.log(err.stack);
    }
    finally {
        await client?.close();
    }
}
run().catch(console.dir);
