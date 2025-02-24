import {
  ContentFormatType,
  ContentFormatFactors,
  ContentTemplate,
} from '../types/article-generation';
// import { elizaLogger } from '@elizaos/core';

export class ContentFormatter {
  private templates: Record<ContentFormatType, ContentTemplate> = {
    deep_dive: {
      type: 'deep_dive',
      sections: [
        { name: 'Executive Summary', required: true },
        { name: 'Background', required: true },
        { name: 'Methodology', required: true },
        { name: 'Evidence Analysis', required: true },
        { name: 'Discussion', required: true },
        { name: 'Conclusions', required: true },
      ],
    },
    roundup: {
      type: 'roundup',
      sections: [
        { name: 'Overview', required: true },
        { name: 'Key Findings', required: true },
        { name: 'Individual Summaries', required: true },
        { name: 'Common Themes', required: true },
        { name: 'Future Directions', required: false },
      ],
    },
    comparative: {
      type: 'comparative',
      sections: [
        { name: 'Introduction', required: true },
        { name: 'Methodology Comparison', required: true },
        { name: 'Key Differences', required: true },
        { name: 'Synthesis', required: true },
      ],
    },
    topic_guide: {
      type: 'topic_guide',
      sections: [
        { name: 'Introduction', required: true },
        { name: 'Core Concepts', required: true },
        { name: 'Key Areas', required: true },
        { name: 'Further Reading', required: true },
      ],
    },
  };

  determineFormat(factors: ContentFormatFactors): ContentFormatType {
    if (factors.depth > 0.8 && factors.evidenceQuality > 0.7) {
      return 'deep_dive';
    } else if (factors.breadth > 0.7) {
      return 'roundup';
    } else if (factors.controversyLevel > 0.6) {
      return 'comparative';
    }
    return 'topic_guide';
  }

  getTemplate(type: ContentFormatType): ContentTemplate {
    return this.templates[type];
  }
}
