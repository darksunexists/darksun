# Perplexity Plugin for Eliza

A plugin that integrates Perplexity AI's search capabilities into the Eliza agent system, enabling intelligent web search and information retrieval.

## Features

- **Intelligent Search**: Leverages Perplexity AI's chat completions API for comprehensive search results
- **Source Reliability**: Evaluates the credibility of search results based on domain authority
- **Search Quality Assessment**: Measures the relevance and quality of search responses
- **Search History**: Maintains a record of previous searches for context

## Components

# Actions

### PERPLEXITY_SEARCH
- Performs web searches using Perplexity's chat completions API
- Uses the llama-3.1-sonar-small-128k-online model
- Returns formatted responses with citations and sources
- Supports various search parameters like temperature and frequency penalty

# Evaluators

### Search Quality Evaluator
- Assesses the quality and relevance of search results
- Evaluates based on:
  - Number of sources
  - Answer comprehensiveness
  - Result relevance

### Source Reliability Evaluator
- Measures the credibility of sources
- Prioritizes domains like .edu, .gov, and .org
- Provides reliability scoring for search results

# Providers

### Search History Provider
- Maintains a record of recent searches
- Returns the last 5 search queries with timestamps
- Helps maintain context across conversations

### Source Provider
- Aggregates sources from recent searches
- Returns formatted citation information
- Helps track and validate information sources