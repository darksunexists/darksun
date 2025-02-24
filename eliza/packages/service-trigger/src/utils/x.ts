import { Scraper, Tweet } from "agent-twitter-client";
import { elizaLogger } from "@elizaos/core";

import { PostInvestigationTweetPayload, TwitterCredentials } from "../types";
import { logger } from "@trigger.dev/sdk/v3";

export async function processTwitterResponse(result: Response, isLongTweet: boolean, username: string): Promise<Tweet> {
  const body = await result.json();
  
  if (body.errors) {
    const error = body.errors[0];
    throw new Error(`Twitter API error (${error.code}): ${error.message}`);
  }

  const tweetResult = isLongTweet
    ? body.data?.notetweet_create?.tweet_results?.result
    : body.data?.create_tweet?.tweet_results?.result;

  if (!tweetResult) {
    throw new Error("Invalid Twitter API response format");
  }

  return {
    id: tweetResult.rest_id,
    text: tweetResult.legacy.full_text,
    conversationId: tweetResult.legacy.conversation_id_str,
    timestamp: new Date(tweetResult.legacy.created_at).getTime() / 1000,
    userId: tweetResult.legacy.user_id_str,
    inReplyToStatusId: tweetResult.legacy.in_reply_to_status_id_str,
    permanentUrl: `https://twitter.com/${username}/status/${tweetResult.rest_id}`,
    hashtags: [],
    mentions: [],
    photos: [],
    thread: [],
    urls: [],
    videos: [],
  };
}

export async function setCookiesFromArray(cookiesArray: any[], scraper: Scraper) {
    const cookieStrings = cookiesArray.map(
        (cookie) =>
            `${cookie.key}=${cookie.value}; Domain=${cookie.domain}; Path=${cookie.path}; ${
                    cookie.secure ? "Secure" : ""
                }; ${cookie.httpOnly ? "HttpOnly" : ""}; SameSite=${
                    cookie.sameSite || "Lax"
                }`
        );
        await scraper.setCookies(cookieStrings);
    }

export async function initializeScraper(credentials: TwitterCredentials): Promise<Scraper> {
  const scraper = new Scraper();
  let retries = 3;

  let parsedCookies = JSON.parse(credentials.cookies);

  while (retries > 0) {   
    try {
      if (await scraper.isLoggedIn()) {
        elizaLogger.info("Twitter scraper already logged in");
        return scraper;
      }

      await setCookiesFromArray(parsedCookies, scraper);

      logger.info("Attempting to login to Twitter", {
        username: credentials.username,
        password: credentials.password,
        email: credentials.email,
        twoFactorSecret: credentials.twoFactorSecret, 
      });

      await scraper.login(
        credentials.username,
        credentials.password,
        credentials.email,
        credentials.twoFactorSecret
      );
      
      if (await scraper.isLoggedIn()) {
        elizaLogger.info("Successfully logged in to Twitter");
        return scraper;
      }
    } catch (error) {
      elizaLogger.error("Twitter login error:", error);
      retries--;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  throw new Error("Failed to login to Twitter after multiple attempts");
}