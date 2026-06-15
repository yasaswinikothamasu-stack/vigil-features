import _ from "lodash";
import { Base, ctxUser } from "../../connect.js";
import jwt from "jsonwebtoken";

export default class Auth {
  base: Base;
  constructor(base: Base) {
    this.base = base;
  }

  createSession(userData: ctxUser) {
    return jwt.sign(userData, process.env.SECRET_TOKEN_KEY!, { expiresIn: '30d' });
  }

  isValidSession(session: string) {
    try {
      const user = this.getUserBySession(session);
      console.log(user,"userrrr...");
      if (_.isEmpty(user)) throw new Error("User is not present!");
      return user;
    } catch (error: any) {
      throw new Error(error.message);
    }
  }
  // getUserBySession(session: string): ctxUser {
  //   try {
  //     return jwt.verify(session, process.env.SECRET_TOKEN_KEY || "") as ctxUser;
  //   } catch (error: any) {
  //     throw new Error('Invalid Session!!');
  //   }
  // }
  getUserBySession(session?: string): ctxUser {
  try {
    if (!session) {
      throw new Error("No session provided");
    }

    return jwt.verify(
      session,
      process.env.SECRET_TOKEN_KEY || ""
    ) as ctxUser;
  } catch {
    throw new Error("Invalid Session!!");
  }
}
}
// const connect = new Connect(token);
// connect.validateSession(token);

// return {
//   connect,
//   user: connect.user
// };