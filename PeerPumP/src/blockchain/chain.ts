import { v4 as uuidv4 } from "uuid";

export interface TokenPost {
  id: string;
  contractAddress: string;
  poster: string;
  timestamp: number;
  endorsements: string[];
  likes: string[];
  dislikes: string[];
  priceAtPost: number;
}

let chain: TokenPost[] = [];
let ratings: Record<string, number> = {};

export const getRating = (user: string) => {
  if (!ratings[user]) ratings[user] = 20;
  return ratings[user];
};

export const updateRating = (user: string, delta: number) => {
  ratings[user] = getRating(user) + delta;
};

export const addPost = (ca: string, poster: string) => {
  const post: TokenPost = {
    id: uuidv4(),
    contractAddress: ca,
    poster,
    timestamp: Date.now(),
    endorsements: [],
    likes: [],
    dislikes: [],
    priceAtPost: Math.random() * 100
  };
  chain.push(post);
  return post;
};

// Dummy data generation
const dummyUsers = ["CryptoWhale", "ElonMusk", "VitalikB", "SatoshiN", "CZ_Binance", "LexLuthor"];
const dummyCAs = [
  "0x1234567890abcdef1234567890abcdef12345678",
  "0xabcdef1234567890abcdef1234567890abcdef",
  "0x7890abcdef1234567890abcdef1234567890ab",
  "0xde0b295669a9fd93d5f28d9ec85e40f4cb697bae",
  "0x3216549870fedcba3216549870fedcba32165498"
];

for (let i = 0; i < 15; i++) {
  const user = dummyUsers[Math.floor(Math.random() * dummyUsers.length)];
  const ca = dummyCAs[Math.floor(Math.random() * dummyCAs.length)];
  const post = addPost(ca, user);
  // Random likes/endorsements
  for (let j = 0; j < Math.floor(Math.random() * 50); j++) {
    post.likes.push("user_" + j);
  }
  for (let j = 0; j < Math.floor(Math.random() * 20); j++) {
    post.endorsements.push("user_" + j);
  }
}

export const getPosts = () => chain;

export const endorse = (postId: string, user: string) => {
  const post = chain.find(p => p.id === postId);
  if (post && !post.endorsements.includes(user)) {
    post.endorsements.push(user);
  }
};

export const vote = (postId: string, user: string, type: "like" | "dislike") => {
  const post = chain.find(p => p.id === postId);
  if (!post) return;
  if (type === "like" && !post.likes.includes(user)) post.likes.push(user);
  if (type === "dislike" && !post.dislikes.includes(user)) post.dislikes.push(user);
};

export const simulateLifecycle = () => {
  chain.forEach(post => {
    const multiplier = Math.random() * 5;
    if (multiplier > 2) {
      updateRating(post.poster, 5);
      post.endorsements.forEach(u => updateRating(u, 3));
    } else {
      updateRating(post.poster, -5);
      post.endorsements.forEach(u => updateRating(u, -3));
    }
  });
};