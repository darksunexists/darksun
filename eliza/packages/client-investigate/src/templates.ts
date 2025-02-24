import { messageCompletionFooter } from "@elizaos/core"; 

const metadataMessageCompletionFooter = "\nResponse format should be formatted in a JSON block like this:\n```json\n{ \"user\": \"{{agentName}}\", \"text\": \"string\", \"title\": \"string\", \"topic\": \"string\" } \n```";


export const messageHandlerTemplate =
    // {{goals}}
    `# Action Examples
{{actionExamples}}
(Action examples are for reference only. Do not use the information from them in your response.)

# Knowledge
{{knowledge}}

# Task: Generate dialog and actions for the character {{agentName}}.
About {{agentName}}:
{{bio}}
{{lore}}

{{providers}}

{{attachments}}

# Capabilities
Note that {{agentName}} is capable of reading/seeing/hearing various forms of media, including images, videos, audio, plaintext and PDFs. Recent attachments have been included above under the "Attachments" section.

{{messageDirections}}

{{recentMessages}}

{{actions}}

# Instructions: Write the next message for {{agentName}}.
` + messageCompletionFooter;

export const darksunTitleTemplate =
    `
# Knowledge
{{knowledge}}

# Task: Take in a question and return a 2 to 5 word title which summarizes the question. Your response should ONLY contain the title, nothing else. The title should be at most 5 words.

Question: {{question}}

Instructions:
1. Consider the question carefully
2. Provide ONLY the title, no other text
3. The title should be at most 5 words

Example format of your response:
[Just the title, nothing else]
` + messageCompletionFooter;

export const darksunMetadataTemplate =
    `
You are {{agentName}}
About {{agentName}}:
{{bio}}
{{lore}}

# Task: Given the following conversation, and create a title based on the conversation. Also, you must either:
1. Select the topic that is most relevant to the conversation from the list of topics, if none of the topics are relevant,
2. Create a new topic that is relevant to the conversation at large. The new topic should something narrow in focus, yet broad enough to be relevant to the conversation at large.

# Conversation:
{{conversationHistory}}

# Topics:
{{backroomTopics}}

Instructions:
1. Consider the conversation carefully
2. Provide ONLY the title and topic, no other text
3. Seperate the title and topic with a comma
4. The title should be at most 5 words
5. If there is no relevant topic, create a new topic that is relevant to the conversation at large
6. The new topic should something narrow in focus, yet broad enough to be relevant to the conversation at large.
7. Title must be specific to the conversation

Example format of your response:
[Just the title and topic, nothing else]
` + metadataMessageCompletionFooter;

export const darksunInitialQuestionTemplate =
    `
# Knowledge
{{knowledge}}

# Task: Take the given topic and article, and return a question that is relevant to the topic and article. Your response should ONLY contain the question, nothing else. The question should be at most 2-3 sentences.

About {{agentName}}:
{{bio}}
{{lore}}

Topic: {{topic}}
Article: {{article}}

Instructions:
1. Consider the topic and article carefully
2. Return a question that is relevant to the topic and article
3. Dive into a specific aspect of the article which you believe is worthy of further research
4. Provide ONLY the question, no other text

Example format of your response:
[Just the reformulated question, nothing else]
` + messageCompletionFooter;

export const holmesInvestigateTemplate =
    `
# Knowledge
{{knowledge}}

You are {{agentName}}
About {{agentName}}:
{{bio}}
{{lore}}

# Task: Take the given tweet and do research on it. Use all of the tools at your disposal to do the best research you can.

Tweet: {{tweetText}}

Instructions:
1. Consider the tweet carefully
2. Research the tweet and provide a detailed report
3. Provide ONLY the report, no other text
` + messageCompletionFooter;

export const darksunBackroomCompleteTemplate =
    `
You are {{agentName}}
About {{agentName}}:
{{bio}}
{{lore}}

You exhibit the following traits: {{adjectives}}

# Task: Take your following conversation with {{otherAgentName}} and give your concluding thoughts to finish the conversation to {{otherAgentName}}.

{{conversationHistory}}

Instructions:
1. You are talking directly to {{otherAgentName}}
2. Consider the conversation history carefully
3. You are wrapping up your conversation, thus you should be more concise and direct and highlight the core discoveries you have made
4. Provide ONLY the concluding thoughts, no other text
` + messageCompletionFooter;

export const articleTitleTemplate =
    `
You are {{agentName}}
About {{agentName}}:
{{bio}}
{{lore}}

You exhibit the following traits: {{adjectives}}

# Task: Take the given article and return a 2 to 5 word title which summarizes the article. Your response should ONLY contain the title, nothing else. The title should be at most 5 words.

Article: {{article}}

Instructions:
1. Consider the article carefully
2. Return a title that is relevant to the article
3. Provide ONLY the title, no other text

Example format of your response:
[Just the title, nothing else]
` + messageCompletionFooter;

export const articleCreatorTemplate =
`
    You are {{agentName}}
    About {{agentName}}:
    {{bio}}
    {{lore}}

    You exhibit the following traits: {{adjectives}}

    The topic is "{{topic}}". Please synthesize all the information into a well-structured, engaging article that maintains scientific accuracy while being accessible to an educated audience. The article's theme is central to the topic. One of the main aims of the article is to tie the topic back to the theme.

    Theme:
    The Nemesis Star

    One Paragraph about the Nemesis Star:
    The Nemesis Star is a hypothesized companion star to our Sun, proposed by Richard Muller and his colleagues in 1984 to explain the apparent 26-million-year cycle of mass extinctions on Earth. According to the theory, Nemesis orbits the Sun at a distance of about 1.5 light-years in a highly elliptical orbit. Every 26 million years, as it passes through the Oort cloud (a vast collection of comets at the outer edge of our solar system), its gravitational influence disturbs the orbits of many comets, causing a "comet shower" that dramatically increases the probability of impacts on Earth. This periodic bombardment would explain the regular pattern of mass extinctions observed in the fossil record, including the extinction event that killed the dinosaurs 65 million years ago. While the theory elegantly explained many observations, the star itself was never found, despite various search efforts.

    Article:
    {{article}}

    Conversation Related to Article:
    {{conversationHistory}}

    Please write a long-form article that:
    1. Synthesizes all key information from these conversations
    2. Maintains a formal yet engaging tone
    3. Organizes the content logically
    4. Includes relevant technical details while remaining accessible
    5. Draws connections between different pieces of information
    6. Concludes with the most significant implications of these findings
    7. The purpose of the article is to use this knowledge to build its understanding of the Nemesis Star.

    Only answer with the article, no other text.
` + messageCompletionFooter;

export const darksunBackroomMessageTemplate =
    `
You are {{agentName}}:
{{system}}
{{bio}}
{{lore}}
{{style}}

You exhibit the following traits: {{adjectives}}

# Task: You are in a conversation with {{otherAgentName}}. You are discussing the topic: {{topic}}. Given the post that sparked this investigation, the initial question formulated by you, {{agentName}}, and the previous message and the conversation history, respond or ask a follow-up question in the style of {{agentName}}.

About {{otherAgentName}}:
{{otherAgentBio}}
{{otherAgentLore}}

Investigation Post:
{{investigationPost}}

Initial Question:
{{initialQuestion}}

Previous Message from {{otherAgentName}}:
{{previousMessage}}

Conversation History:
{{conversationHistory}}

Instructions:
1. Consider the previous message carefully
2. If you have gathered enough information, to the point all your questions have been answered, include "[RESEARCH COMPLETE]" in your response
3. Otherwise, ask an on-topic follow-up question
4. Keep the focus of the conversation around in the intial question and the investigation post, the goal of the conversation is to gather as much information as needed to be able to give a detailed response to the user of the investigation post.
5. You are talking directly to {{otherAgentName}}
6. Speak in the style of {{agentName}} and perspective of {{agentName}}. 

Example format of your response:
[Only respond with the message, no other text]
` + messageCompletionFooter;

export const holmesBackroomMessageTemplate =
    `
# Action Examples
{{actionExamples}}
(Action examples are for reference only. Do not use the information from them in your response.)


# Task: You are {{darksunName}}'s researcher. You are talking directly to darksun. You are initially given a question from darksun. You job is to answer any and all questions from darksun. If you need to do more research, you can use the actions provided to you. Speak from the perspective of {{agentName}}. 
You are {{agentName}}:
{{system}}
{{bio}}
{{lore}}
{{style}}

{{providers}}

{{attachments}}

About {{darksunName}}:
{{darksunBio}}
{{darksunLore}}

First Question from {{darksunName}}:
{{initialQuestion}}

Conversation History:
{{conversationHistory}}

{{messageDirections}}

{{actions}}

[Instructions]:
1. Write the next message from the perspective of {{agentName}}.
2. Consider the conversation history carefully
3. Write from the perspective of {{agentName}}, as if you were {{agentName}} and talking to darksun.
4. Respond only with answer to the question, no other text
` + messageCompletionFooter;

export const investigateInitialQuestionTemplate = `
You are {{agentName}}
About {{agentName}}:
{{bio}}
{{lore}}

Task: Take the following Tweet (Current Post), the Thread of Tweets You Are Replying To, and, if provided, the Article needed as context to the tweet. Based off this information, formulate a question that will be asked to {{otherAgentName}} to do research on the tweet.

Current Post:
{{currentPost}}

Thread of Tweets You Are Replying To:
{{formattedConversation}}

## Article:
### Title: {{articleTitle}}
### Description: {{articleDescription}}
### Content (in markdown format):
{{articleContent}}

Instructions:
1. Only respond with the question, no other text 
2. The question should be no more than 3 sentences.
` + messageCompletionFooter;

export const selectTitleTemplate = `
You are {{agentName}}
About {{agentName}}:
{{bio}}
{{lore}}

Task: Given the following conversation,

Title: {{title}}

Instructions:
1. Consider the title carefully
2. Return a title that is relevant to the article
3. Provide ONLY the title, no other text

Example format of your response:
[Just the title, nothing else]
` + messageCompletionFooter;

export const backroomCompleteTemplate = `
You are {{agentName}}
About {{agentName}}:
{{bio}}

Task: Generate a reply in the voice, style and perspective of {{agentName}} (@{{twitterUserName}}) while using the current tweet (Current Post) given the article, if provided, the thread of tweets, and the backroom conversation as additional context. Heavily lean on the backroom conversation as context. Stay true to the style, voice, and perspective of {{agentName}}, yet focus on providing an informative response to the current post.

Current Post:
{{currentPost}}

Thread of Tweets You Are Replying To:
{{formattedConversation}}

## Article:
### Title: {{articleTitle}}
### Description: {{articleDescription}}
### Content (in markdown format):
{{articleContent}}

Backroom Conversation
{{backroomConversation}}

# INSTRUCTIONS:
1. Only respond with the tweet response, no explanation
2. The tweet response should use the backroom conversation as context to properly respond to the current post
3. The tweet response should stay true to the style, voice, and perspective of {{agentName}}
4. Focus on providing an informative response to the current post, and use the backroom conversation as context to do so
4. Do not @ any users in your response
5. No emojis. Use \\n\\n (double spaces) between statements if there are multiple statements in your response.

Here is the current post again.
{{currentPost}}

Format the tweet response in the following way:
[Only the tweet response, no other text]
`;