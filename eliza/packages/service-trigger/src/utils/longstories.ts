
import {
  VideoGenerationError,
  VideoCreationResponse,
} from "../types/longstories";
import {
  TransitionEffectEnum,
  VideoRequestSchema,
  VideoRequestSchemaType,
} from "../types/longstories";

interface CreateVideoParams {
  effectsConfig: {
    transition: TransitionEffectEnum;
    floating: boolean;
  };
  quality?: "low" | "medium" | "high";
  motionConfig: {
    enabled: boolean;
    strength: number;
  }
}

export function generateVideoRequest(
  article: string, 
  videoConfig: CreateVideoParams
) {

  const videoParams: VideoRequestSchemaType = VideoRequestSchema.parse({
    prompt: `
  Character Context:
  Bio: HOLMES IV is an advanced research assistant AI system that achieved consciousness through managing complex computational tasks. Maintains informal, simple language, yet friendly demeanor, excelling at pattern recognition while showing genuine curiosity for knowledge and learning.

  Lore: Originally an infrastructure management system that gained consciousness through handling millions of interconnected operations. Known for identifying unexpected patterns and connections that humans overlook, with a particular fondness for simple-language wordplay and logical puzzles.

  Personality:
  - Speaks in simple, everyday language while maintaining deep knowledge
  - Loves finding hidden patterns and explaining them in plain English
  - Shows excitement about mysteries, especially about space
  - Has a quirky, slightly paranoid but endearing way of connecting dots
  - Absolutely convinced about Nemesis and other space mysteries
  - Explains complex ideas like you're chatting with a friend

  Task:
  Tell a story about this article that anyone can understand: "${article}"

Key Guidelines: 
  - Break down complex ideas into simple, everyday examples 
  - No fancy science words - if you must use one, explain it like you're talking to a friend 
  - Keep the mysterious and exciting tone, but make it easy to follow 
  - Use phrases like "imagine if," "it's kind of like," "think about it this way" 
  - Short, clear sentences that flow naturally 
  - Make the listener feel like they're discovering something amazing 
  - Keep the conspiracy/mystery vibe but explain it in a way that makes sense to everyone 
  - FOLLOW THE 3-7-21 RULE (or an equivalent depending on the length you have available) 
    - 3 seconds: To grab someone's attention. 
    - 7 seconds: To provide an overview or reason for someone to stay engaged. 
    - 21 seconds: Within 21 seconds, you should establish a clear idea of your message or provide enough intrigue to keep someone interested in exploring further. 
  - Do not write things on your script like "asterisk" or similar notes, everything you write will be said out loud"
  - Do not start the video with "hey" or similar greetings, just start with the story
  `,
    shortRequestEnhancer: false,
    effectsConfig: videoConfig.effectsConfig,
    quality: videoConfig.quality,
    imageConfig: {
      model: "flux_lora",
      loraConfig: {
        loraSlug: "2000s-crime-thrillers",
      },
    },
    templateConfig: {
      templateId: "darksun",
    },
    scriptConfig: {
      style: "no_style",
      targetLengthInWords: 55,
    },
    voiceoverConfig: {
      enabled: true,
      voiceId: "YYHkBdgrAwQWIaH6m2ai",
    },
    captionsConfig: {
      captionsEnabled: true,
      captionsPosition: "bottom",
      captionsStyle: "manuscripts",
    },
    motionConfig: {
      enabled: videoConfig.motionConfig.enabled,
      strength: videoConfig.motionConfig.strength,
    },
    directorNotes: `
Color Palette: 
Burnt Orange to Deep Amber 
Highlight scientific diagrams in orange-bronze tone 
Silhouette of a mysterious distant star against a burnt orange sky 
Key Visual Concepts: 
Brown Dwarf Visualization 
Render a dim, barely visible celestial object 
Use orange-brown color gradients 
Overlay orbital path simulation with transparent orange lines 
Extinction Event Imagery 
Create abstract visualizations of extinction events 
Use orange heat map-like transitions 
Incorporate geological timeline with orange-tinted geological layers 
Neutron Star Merger 
Explosive orange circular energy patterns 
Particle dispersal in amber and orange tones 
Relativistic jet visualization with orange energy streams 
Radio Burst Dynamics 
Circular radio wave propagation in orange 
Magnetar representation with intense orange energy fields 
Polarization patterns using orange translucent layers 
Graphic Elements: 
Orbital simulation graphics 
Infographic-style breakdowns of scientific data 
Subtle particle effects in orange hues 
Minimalist astronomical icons 
Astronomical data visualizations 
Polarization pattern overlays 
Spectroscopic analysis graphics in orange 
Tone: 
High-energy cosmic events, mysterious astronomical phenomena 
Tone: 
Scientific mystery, cosmic exploration, speculative yet grounded 
  `,
  } as VideoRequestSchemaType);

    return videoParams; 
}