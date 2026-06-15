import mercury from "@mercury-js/core";
import bcrypt from "bcryptjs";
import { redisConnection as redis} from "../utils/redis";
import { sendOtpEmail } from "../utils/sendEmail";
import { sendOtpSms,sentMessage } from "../utils/sendSms";
import { emailQueue, messageWorker } from "./queue";
import { ApolloCtx, ctxUser } from "../connect";
import { setContext } from "../helpers/setContext.ts";
import { ensureContactForSender } from "../functions";
import jwt from "jsonwebtoken";
import { UserOAuthTokens } from "../models/UserOAuthTokens.ts";
import { decrypt } from "dotenv";
import mongoose from "mongoose";
import { google } from "googleapis";
import { GraphQLError } from "graphql";
import { MongoClient } from 'mongodb';
import {getEmbedding} from '../utils/embeddings.js'

import dotenv from "dotenv";
dotenv.config();
import { calculateFinalScore } from "../functions/finalScore";
import {
  calculatePriorityScore,
} from "../functions";
import { notifyUser } from "../socket";
export const resolvers = {
  Query: {
    hello: (_: any, { name }: { name: string }) =>
      `Hello ${name || "World"}`,
    getGmailConsentUrl: async (_: any,{ input }: { input: { token ?:string } }, ctx: any) => {
    if (!ctx.user?.id) {
      throw new GraphQLError("Unauthorized");
    }
    console.log(ctx.user.is,"iddd");
    console.log("CLIENT_ID =", process.env.CLIENT_ID);
    console.log("CLIENT_SECRET =", process.env.CLIENT_SECRET);
    console.log("REDIRECT_URI =", process.env.REDIRECT_URI);
    const oauth2Client = new google.auth.OAuth2(
      process.env.CLIENT_ID,
      process.env.CLIENT_SECRET,
      process.env.REDIRECT_URI
    );
    console.log(oauth2Client,"oauth2Client...");
    let gmailOAuthClient=oauth2Client;
    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/userinfo.email",
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/gmail.modify",
      ],
      state: ctx.user.id, // VERY IMPORTANT
    });
    return {url};
    },
    getImportantNotifications: async (
    _: any,
    { input }: { input?: { limit?: number; minPriority?: number } },
    ctx: any
    ) => {
    try {
      const ownerUserId = ctx.user.id;
      console.log(ownerUserId,"ownerrr..");
      const limit = input?.limit ?? 2;
      const minPriority = input?.minPriority ?? 0;
      const notifications = await mercury.db.Message.mongoModel.find(
        {
          ownerUserId,
          channel: "EMAIL",
          isRead: false,
          isArchived: false,
          isDeleted: false,
          isActive: true,
          priorityScore: { $gte: minPriority },
        },
        {
          messageId: 1,
          senderEmail: 1,
          senderName: 1,
          subject: 1,
          sent_at: 1,
          priorityScore: 1,
          threadId: 1,
          contactId: 1,
        }
      )
        .sort({
          priorityScore: -1,
          sent_at: -1,
        })
        .limit(limit)
        .lean();
      console.log(notifications,"notifications");
      return {
        count: notifications.length,
        notifications,
      };
    } catch (error) {
      console.error("getImportantNotifications error:", error);
      return {
        count: 0,
        notifications: [],
      };
  };
    },
    getUniquegmails: async (
      _: any,
      { input }: { input: { isEmail: boolean } },
      ctx: any
    ) => {
      try {
      const ownerUserId = new mongoose.Types.ObjectId(ctx.user.id);
      const senderStats = await mercury.db.SenderStats.mongoModel.find({
        ownerUserId
      });
     return senderStats.map((stat:any)=>({
        senderEmail:stat.senderEmail,
        senderName:stat.senderName,
        emailCount:stat.emailCount
      }));
      } catch (error) {
        console.error("getUniquegmails error:", error);
        return null;
      }
    },
    //apis to expose to the chatbot
    getTopItems: async (
      _: any, 
      { limit = 5 }, 
      ctx: any
    ) => {
      if (!ctx.user?.id) throw new Error("Unauthorized");

      const authCtx = { id: "system", profile: "SUPER_ADMIN" };

      const user = await mercury.db.User.get(
        { _id: ctx.user.id }, 
        authCtx
      );

      if (!user || !user.isMsgConsent) return [];

      const messages = await mercury.db.Message.list(
        {
          ownerUserId: ctx.user.id,
          isRead: false,
          isDeleted: false,
          isArchived: false,
        },
        authCtx,
        { limit: 20 }
      );

      const scored = await Promise.all(
        messages.map(async (m: any) => ({
          message: m,
          finalScore: await calculateFinalScore({
            basePriorityScore: m.priorityScore,
            ownerUserId: ctx.user.id,
            senderUserId: m.senderUserId,
            authCtx,
          }),
        }))
      );

      scored.sort((a, b) => b.finalScore - a.finalScore);

      return scored.slice(0, limit).map(({ message, finalScore }) => ({
        messageId: message.id,
        senderName: message.senderName,
        content: message.subject || message.content,
        finalScore,
        channel: message.channel,
      }));
    },

    getAssistantSummary: async (
      _: any, 
      { limit = 3 }, 
      ctx:any
     ) => {
      const items = await resolvers.Query.getTopItems(_, { limit }, ctx);

      if (!items.length) {
        return { message: "No important updates right now." };
      }

      const message = items
        .map((item, i) => {
          const urgent = item.finalScore > 80 ? "⚠️" : "";
          return `${i + 1}. ${urgent} ${item.content}`;
        })
        .join("\n");

      return { message };
    },

    performAction: async (
      _: any, 
      { input }: any, 
      ctx:any
    ) => {
      if (!ctx.user?.id) throw new Error("Unauthorized");

      const authCtx = { id: "system", profile: "SUPER_ADMIN" };
      const { messageId, action } = input;

      if (action === "mark_read") {
        await mercury.db.Message.update(
          { _id: messageId},
          { isRead: true },
          authCtx
        );
      }

      if (action === "archive") {
        await mercury.db.Message.update(
          { _id: messageId },
          { isArchived: true },
          authCtx
        );
      }
      return { success: true };
    },
    searchSimilarMessages: async (
      _: any, 
      { input }: any,  
      ctx:any
    ) => {
    if (!ctx.user?.id) throw new Error("Unauthorized");
    const { query, limit = 5 } = input;
    
  
    const client = new MongoClient(process.env.DB_URL);
    await client.connect();

    const db = client.db("test");
    const collection = db.collection("senderstats");

    // 1️⃣ Convert query → embedding
    const queryEmbedding = await getEmbedding(query);

    // 2️⃣ Vector search
    const results = await collection.aggregate([
      {
      $vectorSearch: {
        index: "vector_index",
        queryVector: queryEmbedding,
        path: "embedding",
        numCandidates: 50,
        limit
      }
      }
      ]).toArray();

      await client.close();

      return results.map((doc: any) => ({
        messageId: doc._id,
        senderName: doc.senderName,
        content: doc.lastSubject,
        channel: "email"
      }));
},
},
  Mutation: {
    signUp: async (
      _: any,
      { input }: { input: any },
      ctx: ApolloCtx
      ) => {
      const { email, phone, name, password } = input;

      const authCtx = {
        id: "system",
        profile: "SUPER_ADMIN",
      };

      const normalizedEmail = email.trim().toLowerCase();
      const normalizedPhone = phone.trim();

      const existingUsers = await mercury.db.User.list(
        {
          $or: [
            { email: normalizedEmail },
            { phone: normalizedPhone },
          ],
        },
        authCtx
      );

      if (existingUsers.length > 0) {
        throw new Error("User already exists");
      }

      const newUser = await mercury.db.User.create(
        {
          email: normalizedEmail,
          phone: normalizedPhone,
          name,
          password,
        },
        authCtx
      );

      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      await redis.setex(`otp:email:${normalizedEmail}`, 300, otp);
      await redis.setex(`otp:phone:${normalizedPhone}`, 300, otp);

      try {
        await Promise.all([
          sendOtpEmail(normalizedEmail, otp),
          sendOtpSms(normalizedPhone, otp),
        ]);
      } catch (err) {
        console.error("OTP notification failed", err);
      }

      return {
        message:
          "User registered successfully. Please verify email and phone.",
        userId: newUser.id,
      };
    },
    verifyPhoneOtp: async (
      _: any,
      { input }: { input: { phone: string; otp: string } }
    ) => {
      const authCtx = {
        id: "system",
        profile: "SUPER_ADMIN",
      };
      const phone = input.phone.trim();
      const storedOtp = await redis.get(`otp:phone:${phone}`);

      if (!storedOtp) {
        throw new Error("Phone OTP expired or not found");
      }

      if (storedOtp !== input.otp) {
        throw new Error("Invalid Phone OTP");
      }

      const users = await mercury.db.User.list(
        { phone },
        authCtx
      );

      if (users.length === 0) {
        throw new Error("User not found");
      }

      await mercury.db.User.update(
        { _id: users[0].id },
        { isPhoneVerified: true },
        authCtx
      );

      await redis.del(`otp:phone:${phone}`);

      return { message: "Phone verified successfully" };
    },
    verifyEmailOtp: async (
      _: any,
      { input }: { input: { email: string; otp: string } }
    ) => {
      const authCtx = {
        id: "system",
        profile: "SUPER_ADMIN",
      };
      const email = input.email.trim().toLowerCase();
      const storedOtp = await redis.get(`otp:email:${email}`);

      if (!storedOtp) {
        throw new Error("Email OTP expired or not found");
      }

      if (storedOtp !== input.otp) {
        throw new Error("Invalid Email OTP");
      }

      const users = await mercury.db.User.list(
        { email },
        authCtx
      );

      if (users.length === 0) {
        throw new Error("User not found");
      }

      await mercury.db.User.update(
        { _id: users[0].id },
        { isEmailVerified: true },
        authCtx
      );

      await redis.del(`otp:email:${email}`);

      return { message: "Email verified successfully" };
    },
    signIn: async (
      _: any,
      { input }: { input: { identifier: string; password: string } },
      ctx: any // Ensure ctx is available here
    ) => {
      const authCtx = {
        id: "system",
        profile: "SUPER_ADMIN",
      };

      const identifier = input.identifier.trim().toLowerCase();

      const users = await mercury.db.User.list(
        {
          $or: [{ email: identifier }, { phone: identifier }],
        },
        authCtx
      );

      if (users.length === 0) {
        throw new Error("Invalid credentials");
      }

      const user = users[0];

      if (!user.isEmailVerified || !user.isPhoneVerified) {
        throw new Error("Please verify email and phone");
      }

      const isValid = await bcrypt.compare(input.password, user.password);

      if (!isValid) {
        throw new Error("Invalid credentials");
      }
      console.log(user);
      // --- CHANGED SECTION START ---
      // Using Mercury's built-in session management
      const token = ctx.base.Auth.createSession({
        id: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email,
      });

      console.log(token, "token....");
      // --- CHANGED SECTION END ---

      await mercury.db.User.update(
        { _id: user.id },
        { lastLoginAt: new Date() },
        authCtx
      );
      return {
        message: "Sign in successful",
        userId: user.id,
        token, // Returning the session token generated by Mercury
      };
    },
    creatingContact: async (
      _: any,
      {
        input: { contactUserId, relationship },
      }: {
        input: {
          contactUserId: string;
          relationship?: string;
        };
      },
      ctx: any
    ) => {
      console.log("Creating contacttt:", ctx);
      if (!ctx.user?.id) {
        throw new Error("Unauthorized");
      }
      const authCtx = { id: "system", profile: "SUPER_ADMIN" };
      const users = await mercury.db.User.list(
        { _id: contactUserId },
        authCtx
      );

      if (users.length === 0) {
        throw new Error("Contact user not found");
      }
      const contactUser = users[0];
      if (contactUser.id === ctx.user.id) {
        throw new Error("You cannot add yourself as a contact");
      }
      const existing = await mercury.db.Contact.list(
        {
          ownerUserId: ctx.user.id,
          contactUserId,
        },
        authCtx
      );

      if (existing.length > 0) {
        throw new Error("Contact already exists");
      }
      const contact = await mercury.db.Contact.create(
        {
          ownerUserId: ctx.user.id,
          contactUserId,
          email: contactUser.email,
          phone: contactUser.phone,
          ownerContactRelationship: relationship,
          isActive: true,
        },
        authCtx
      );

      return {
        id: contact.id,
        email: contact.email,
        phone: contact.phone,
        relationship: contact.ownerContactRelationship,
      };
    },
    updateMsgConsent: async (
      _: any,
      { input: { consent } }: { input: { consent: boolean } },
      ctx: ApolloCtx
    ) => {
      // 🔐 Must be logged in
      if (!ctx.user?.id) {
        throw new Error("Unauthorized");
      }

      const authCtx = { id: "system", profile: "SUPER_ADMIN" };

      // ✅ Update consent
      await mercury.db.User.update(
        { _id: ctx.user.id },
        {
          isMsgConsent: consent,
        },
        authCtx
      );

      return {
        message: consent
          ? "Message consent granted"
          : "Message consent revoked",
        isMsgConsent: consent,
      };
    },
    sendMessage: async (
      _: any,
      { input }: { input: any },
      ctx: ApolloCtx
    ) => {
      // 1️⃣ Auth check
      if (!ctx.user?.id) {
        throw new Error("Unauthorized");
      }

      // 2️⃣ System context for DB ops
      const authCtx = {
        id: "system",
        profile: "SUPER_ADMIN",
      };

      const receiverUserId = input.contactId; // rename mentally as receiverUserId

      // 3️⃣ ✅ Validate receiver user exists
      const receiver = await mercury.db.User.get(
        { _id: receiverUserId },
        authCtx
      );
      const phone = receiver?.phone.trim();
      if (!receiver) {
        throw new Error("Receiver user does not exist");
      }

      // 4️⃣ ✅ Find contact scoped to sender
      const contacts = await mercury.db.Contact.list(
        {
          ownerUserId: ctx.user.id,
          contactUserId: receiverUserId,
        },
        authCtx
      );

      let contact;

      // 5️⃣ Create contact if not found
      if (contacts.length === 0) {
        contact = await mercury.db.Contact.create(
          {
            ownerUserId: ctx.user.id,        // sender
            contactUserId: receiverUserId,   // receiver
            ownerContactRelationship: "STRANGER",
          },
          authCtx
        );
      } else {
        contact = contacts[0];
      }

      // 6️⃣ Calculate priority
      const priorityScore = calculatePriorityScore(
        contact.ownerContactRelationship,
        input.content
      );

      // 7️⃣ Create message (owned by receiver)
      const message = await mercury.db.Message.create(
        {
          ownerUserId: receiverUserId, // inbox owner (receiver)
          senderUserId: ctx.user.id,
          senderName: ctx.user.name,
          senderPhone: ctx.user.phone,
          contactId: contact.id,
          channel: input.channel,
          subject: input.subject,
          content: input.content,
          priorityScore,
          isPublished: true,
        },
        authCtx
      );
      sentMessage(phone, input.content);

      // 8️⃣ Return minimal response
      return {
        id: message.id,
        priorityScore,
      };
    }, 
    topPriorityNotifications: async (
      _: any,
      { limit }: { limit: 5 },
      ctx: ApolloCtx
    ) => {
      // 🔐 Must be logged in
      if (!ctx.user?.id) {
        throw new Error("Unauthorized");
      }

      const authCtx = {
        id: "system",
        profile: "SUPER_ADMIN",
      };
      console.log("Fetching top priority notifications for user:",);
      console.log("User ID:", ctx.user.id);
      // 1️⃣ Check message consent
      const user = await mercury.db.User.get(
        { _id: ctx.user.id },
        authCtx
      );
      console.log("User details:", user);
      //const user = users[0];
      if (!user || !user.isMsgConsent) {
        return [];
      }
      const id = user.id;
      console.log("User has given message consent.", id);
      // 2️⃣ Fetch candidate messages
      // Fetch more than limit so scoring makes sense
      const sevenDaysAgo = new Date(
        Date.now() - 7 * 24 * 60 * 60 * 1000
      );
     console.log(id,"iddddd")
    

      const ownerUserId = new mongoose.Types.ObjectId(id);
      console.log(ownerUserId);
      const messages = await mercury.db.Message.list(
        {
          ownerUserId,
          isRead: false,
          isDeleted: false,
          isArchived: false,
          notifiedCount: { $lt: 5 }, // 👈 simplified
        },
        authCtx,
        { limit: 20 }
      );

      console.log("Candidate messages:", messages);
      if (messages.length === 0) {
        return [];
      }

      // 3️⃣ Calculate FINAL SCORE for each message
      const scoredMessages = await Promise.all(
        messages.map(async (m: any) => {
          const finalScore = await calculateFinalScore({
            basePriorityScore: m.priorityScore, // stored base score
           // sentAt: m.updatedOn,
            ownerUserId: id,
            senderUserId: m.senderUserId,
            authCtx,
          });

          return {
            message: m,
            finalScore,
          };
        })
      );
      console.log("Scored messages:", scoredMessages)

      // 4️⃣ Sort by FINAL SCORE (descending)
      scoredMessages.sort(
        (a, b) => b.finalScore - a.finalScore
      );

      // 5️⃣ Pick top 1
      // Pick top 2 scored messages
const topMessages = scoredMessages.slice(0, 2);

if (!topMessages.length) {
  return [];
}

// Update DB + notify user
// Collect socket payloads
const socketPayload: any[] = [];

for (const top of topMessages) {
  // Update DB safely
  await mercury.db.Message.update(
    { _id: top.message.id },
    {
      $inc: { notifiedCount: 1 },
      lastNotifiedAt: new Date(),
    },
    authCtx
  );

  // Prepare payload for socket
  socketPayload.push({
    messageId: top.message.id,
    senderName: top.message.senderName,
    content: top.message.subject || top.message.content,
    finalScore: top.finalScore,
    // sentAt: new Date(top.message.sent_at).toISOString(),
  });

  console.log(
    "Top priority message selected:",
    top.finalScore,
    top.message.id
  );
}

// Emit ONCE with 2 messages
if (socketPayload.length > 0) {
  notifyUser(id, socketPayload);
}


// Return top 2 messages
return topMessages.map(top => ({
  messageId: top.message.id,
  senderName: top.message.senderName,
  content: top.message.subject || top.message.content,
  basePriorityScore: top.message.priorityScore,
  finalScore: top.finalScore,
  channel:top.message.channel
 // sentAt: new Date(top.message.sent_at).toISOString(),
}));

    },
    //   creatingEmailContact: async (
    //     _: any,
    //     { input }: { input: { senderEmail: string } },
    //     ctx: any
    //   ) => {
    //     try {
    //   const ownerUserId = new mongoose.Types.ObjectId(ctx.user.id);

    //   // 1️⃣ Fetch sender stats
    //   const senderStats = await mercury.db.SenderStats.mongoModel.findOne({
    //     ownerUserId,
    //     senderEmail: input.senderEmail,
    //   });

    //   if (!senderStats) {
    //     return { message: false };
    //   }

    //   // 2️⃣ Already linked
    //   if (senderStats.contactId) {
    //     return { message: true };
    //   }

    //   // 3️⃣ Create contact
    //   const contactId = await ensureContactForSender({
    //     ownerUserId: senderStats.ownerUserId.toString(),
    //     senderEmail: senderStats.senderEmail,
    //     relationship: "STRANGER",
    //   });

    //   // 4️⃣ Link contact
    //   await mercury.db.SenderStats.mongoModel.updateOne(
    //     { _id: senderStats._id, contactId: null },
    //     { $set: { contactId } }
    //   );

    //   return { message: true };

    // } catch (error) {
    //   console.error("creatingEmailContact error:", error);
    //   return { message: false };
    // }
    //   },
    //   updatingEmailContact: async (
    //     _: any,  
    //     { input:{senderEmail,relationship} }: { input: { senderEmail: string,relationship:string } }, 
    //     ctx:any) => {
    //     try {
    //        const ownerUserId=ctx.user.id
    //        const senderStats = await mercury.db.SenderStats.mongoModel.findOne({
    //           ownerUserId,
    //           senderEmail:senderEmail,
    //         });
    //         console.log(senderStats,"senderstats");
    //         if (!senderStats.contactId) {
    //           const contactId = await ensureContactForSender(
    //             {
    //               ownerUserId: senderStats.ownerUserId.toString(),
    //               senderEmail: senderStats.senderEmail,
    //               relationship:relationship
    //             },
    //           );
    //           console.log(contactId,"contactId");
    //         }
    //         else{
    //           const updated= await mercury.db.Contact.mongoModel.updateOne(
    //             {
    //                 primaryEmail:senderEmail,
    //                 ownerUserId
    //             },
    //             {
    //               $set: {
    //                 relationship,
    //                 updatedOn: new Date()
    //                 }
    //               }
    //             );
    //             console.log(updated,"updatedcontact");
    //         }
    //         return true
    //     } catch (error) {
    //       console.error("creatingEmailContact error:", error);
    //       return false;
    //     }
    //   },
    creatingEmailContact: async (
          _: any,
          { input }: { input: { senderEmail: string } },
          ctx: any
        ) => {
          try {
            const ownerUserId = ctx.user.id;
            const email = input.senderEmail.trim().toLowerCase();

            const senderStats = await mercury.db.SenderStats.mongoModel.findOne({
              ownerUserId,
              senderEmail: email,
            });

            if (!senderStats) {
              return { message: false };
            }

            // Already linked
            if (senderStats.contactId) {
              return { message: true };
            }

            // Create contact
            const contactId = await ensureContactForSender({
              ownerUserId,
              senderEmail: email,
              relationship: "STRANGER",
            });

            // Link contact
            await mercury.db.SenderStats.mongoModel.updateOne(
              { _id: senderStats._id },
              { $set: { contactId } }
            );

            return { message: true };

          } catch (error) {
            console.error("creatingEmailContact error:", error);
            return { message: false };
          }
    },
    updatingEmailContact: async (
        _: any,
        {
          input: { senderEmail, relationship },
        }: { input: { senderEmail: string; relationship: string } },
        ctx: any
      ) => {
        try {
          const ownerUserId = ctx.user.id;
          const email = senderEmail.trim().toLowerCase();

          const senderStats = await mercury.db.SenderStats.mongoModel.findOne({
            ownerUserId,
            senderEmail: email,
          });

          if (!senderStats) return false;

          let contactId = senderStats.contactId;

          // If no contact → create
          if (!contactId) {
            contactId = await ensureContactForSender({
              ownerUserId,
              senderEmail: email,
              relationship,
            });

            // 🔥 IMPORTANT: link it
            await mercury.db.SenderStats.mongoModel.updateOne(
              { _id: senderStats._id },
              { $set: { contactId } }
            );
          } else {
            // Update existing contact
            await mercury.db.Contact.mongoModel.updateOne(
              {
                _id: contactId,
              },
              {
                $set: {
                  relationship,
                  updatedOn: new Date(),
                },
              }
            );
          }

          return true;

        } catch (error) {
          console.error("updatingEmailContact error:", error);
          return false;
        }
    }
    }
}