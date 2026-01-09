import { NextRequest, NextResponse } from 'next/server';

/**
 * Server-side API endpoint for internet search
 * Supports Tavily and SerpAPI with automatic fallback
 */
export async function POST(req: NextRequest) {
  try {
    const { query } = await req.json();

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Query parameter is required' },
        { status: 400 }
      );
    }

    // Try Tavily API first if API key is available
    const tavilyApiKey = process.env.TAVILY_API_KEY;
    if (tavilyApiKey) {
      try {
        const response = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            api_key: tavilyApiKey,
            query: query,
            search_depth: 'basic',
            include_answer: true,
            max_results: 5,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          return NextResponse.json({
            success: true,
            query: query,
            answer: data.answer || '',
            results: data.results?.map((r: any) => ({
              title: r.title,
              url: r.url,
              content: r.content,
            })) || [],
          });
        }
      } catch (err) {
        console.warn('Tavily search failed, trying fallback:', err);
      }
    }

    // Try SerpAPI as fallback
    const serpApiKey = process.env.SERPAPI_API_KEY;
    if (serpApiKey) {
      try {
        const params = new URLSearchParams({
          api_key: serpApiKey,
          q: query,
          engine: 'google',
          num: '5',
        });

        const response = await fetch(`https://serpapi.com/search?${params}`);

        if (response.ok) {
          const data = await response.json();
          const organicResults = data.organic_results || [];

          return NextResponse.json({
            success: true,
            query: query,
            answer: data.answer_box?.answer || '',
            results: organicResults.map((r: any) => ({
              title: r.title,
              url: r.link,
              content: r.snippet,
            })),
          });
        }
      } catch (err) {
        console.warn('SerpAPI search failed:', err);
      }
    }

    // If no API keys are available, return error
    return NextResponse.json({
      success: false,
      query: query,
      error: 'Internet search is not configured. Please set up TAVILY_API_KEY or SERPAPI_API_KEY in environment variables.',
      results: [],
    }, { status: 500 });

  } catch (error) {
    console.error('Internet search error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to perform internet search',
      results: [],
    }, { status: 500 });
  }
}
