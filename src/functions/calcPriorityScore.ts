export const getRelationshipScore = (relationship: string): number => {
  switch (relationship) {
    case "FAMILY":
      return 100;
    case "BOSS":
      return 90;
    case "CO_WORKER":
      return 70;
    case "FRIEND":
      return 50;
    default:
      return 20; // STRANGER
  }
};
export const getContentUrgencyScore = (content: string): number => {
  const text = (content || "").toLowerCase();
 let score = 0;

  const rules = [
    { words: ["urgent", "asap", "immediately"], score: 40 },
    { words: ["important", "priority"], score: 25 },
    { words: ["today", "call me", "now"], score: 15 },
    { words: ["please"], score: 10 },
    { words: ["reminder"], score: 10 },
    { words: ["offer", "sale"], score: -10 },
    { words: ["advertisement", "promo"], score: -20 },
  ];

  for (const rule of rules) {
    if (rule.words.some(word => text.includes(word))) {
      score += rule.score;
    }
  }

  return score;
};

export const detectCategory = (
  senderEmail: string,
  subject: string,
  body: string
): string => {
  const text =
    `${senderEmail} ${subject} ${body}`.toLowerCase();

  // Finance
  if (
    /bank|hdfc|icici|sbi|axis|razorpay|upi|payment|refund|invoice|statement|credit card|debit card|transaction|otp/.test(text)
  ) {
    return "FINANCE";
  }

  // Work
  if (
    /github|gitlab|jira|atlassian|slack|teams|meeting|deployment|review|task|sprint/.test(text)
  ) {
    return "WORK";
  }

  // Education
  if (
    /exam|result|hall ticket|admit card|course|assignment|college|university/.test(text)
  ) {
    return "EDUCATION";
  }

  // Marketing
  if (
    /unsubscribe|offer|sale|discount|promo|newsletter|deal|coupon/.test(text)
  ) {
    return "MARKETING";
  }

  // Social
  if (
    /linkedin|facebook|instagram|twitter|x.com|follow|connection request/.test(text)
  ) {
    return "SOCIAL";
  }

  return "OTHER";
};

export const getCategoryScore = (category: string): number => {
  switch (category) {
    case "BANK":
      return 80;
    case "EXAMS":
      return 85;
    case "COMPANY":
      return 60;
    case "MARKETING":
      return -30;
    case "SOCIAL":
      return 20;
    default:
      return 0;
  }
};
export const getEmailUrgencyScore = (
    subject: string,
    body: string
  ): number => {
  const text = `${subject || ""} ${body || ""}`.toLowerCase();

  let score = 0;

  const rules = [
    // 🔥 High urgency
    { words: ["urgent", "asap", "immediately"], score: 50 },

    // 🔥 Work / deadlines
    { words: ["deadline", "due today", "action required"], score: 40 },

    // ⚠️ Medium
    { words: ["important", "priority"], score: 25 },
    { words: ["today", "now"], score: 20 },

    // 👍 Soft signals
    { words: ["please", "request"], score: 10 },
    { words: ["reminder", "follow up"], score: 15 },

    // ❌ Noise / promotions
    { words: ["unsubscribe", "offer", "sale"], score: -20 },
    { words: ["newsletter", "promo", "advertisement"], score: -30 },
  ];

  for (const rule of rules) {
    if (rule.words.some(word => text.includes(word))) {
      score += rule.score;
    }
  }

  return score;
};

export const calculatePriorityScore = (
  relationship: string,
  content: string
): number => {
  const relationshipScore = getRelationshipScore(relationship);
  const contentScore = getContentUrgencyScore(content);
  return relationshipScore + contentScore;
};

export const emailcalculatePriorityScore = (
  relationship: string,
  subject: string,
  body: string,
  senderEmail: string
): number => {
  const relationshipScore = getRelationshipScore(relationship);
  const category = detectCategory(senderEmail, subject, body);
  const categoryScore = getCategoryScore(category);
  const contentScore = getEmailUrgencyScore(subject, body);
  return relationshipScore + categoryScore + contentScore;
};
