import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'
import type { CategorizationResult, Category, Severity } from '@/lib/types'

const VALID_CATEGORIES: Category[] = ['pothole', 'streetlight', 'water_leak', 'waste', 'other']
const VALID_SEVERITIES: Severity[] = ['low', 'medium', 'high']

const FALLBACK: CategorizationResult = {
  category: 'other',
  severity: 'medium',
  description: 'Could not auto-categorize. Please confirm the issue type.',
  fallback: true,
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { imageBase64 } = body as { imageBase64?: string }

    if (!imageBase64) {
      return NextResponse.json(FALLBACK, { status: 200 })
    }

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

    const completion = await groq.chat.completions.create({
      model: 'qwen/qwen3.6-27b',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `You are a civic infrastructure issue classifier. Analyze this photo and respond with ONLY a JSON object (no markdown, no explanation).

The JSON must have exactly these fields:
- "category": one of exactly ["pothole", "streetlight", "water_leak", "waste", "other"]
- "severity": one of exactly ["low", "medium", "high"]  
  - low = minor inconvenience, no immediate danger
  - medium = significant problem, affects daily life
  - high = safety hazard, urgent repair needed
- "description": one concise sentence (max 20 words) describing what is visible in the photo

Example response:
{"category":"pothole","severity":"high","description":"Large pothole covering half the lane with exposed subbase, posing serious vehicle damage risk."}`,
            },
            {
              type: 'image_url',
              image_url: {
                url: imageBase64,
              },
            },
          ],
        },
      ],
      max_tokens: 200,
      temperature: 0.1,
    })

    const raw = completion.choices[0]?.message?.content?.trim() ?? ''

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(raw)
    } catch {
      console.error('[categorize] JSON parse failed:', raw)
      return NextResponse.json(FALLBACK)
    }

    const category = VALID_CATEGORIES.includes(parsed.category as Category)
      ? (parsed.category as Category)
      : 'other'

    const severity = VALID_SEVERITIES.includes(parsed.severity as Severity)
      ? (parsed.severity as Severity)
      : 'medium'

    const description =
      typeof parsed.description === 'string' && parsed.description.length > 0
        ? parsed.description.slice(0, 200)
        : 'Infrastructure issue detected.'

    const result: CategorizationResult = { category, severity, description }
    return NextResponse.json(result)
  } catch (err) {
    console.error('[categorize] Error:', err)
    return NextResponse.json(FALLBACK)
  }
}
