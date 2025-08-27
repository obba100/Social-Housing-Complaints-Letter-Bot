// src/app/api/chat/route.ts - Complete file with natural guidance, specific legal citations, email search, and timeline breach detection
import { NextRequest } from 'next/server';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// Add Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE!
);

type Msg = { role: 'user' | 'assistant'; content: string };

/* -------------------------- UTILITY FUNCTIONS -------------------------- */

// Calculate working days between two dates (excluding weekends)
function calculateWorkingDays(startDate: Date, endDate: Date): number {
  let workingDays = 0;
  let currentDate = new Date(startDate);
  
  while (currentDate <= endDate) {
    const dayOfWeek = currentDate.getDay();
    // 0 = Sunday, 6 = Saturday
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      workingDays++;
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  return workingDays;
}

// Parse date from various formats, including relative dates
function parseDate(dateString: string): Date | null {
  if (!dateString) return null;
  
  const today = new Date();
  
  // Handle relative dates like "X weeks ago", "X months ago", etc.
  const relativePatterns = [
    /(\d+)\s+weeks?\s+ago/i,
    /(\d+)\s+months?\s+ago/i,
    /(\d+)\s+days?\s+ago/i,
    /(\d+)\s+years?\s+ago/i,
  ];
  
  for (const pattern of relativePatterns) {
    const match = dateString.match(pattern);
    if (match) {
      const amount = parseInt(match[1]);
      const parsed = new Date(today);
      if (pattern.toString().includes('week')) {
        parsed.setDate(parsed.getDate() - amount * 7);
      } else if (pattern.toString().includes('month')) {
        parsed.setMonth(parsed.getMonth() - amount);
      } else if (pattern.toString().includes('day')) {
        parsed.setDate(parsed.getDate() - amount);
      } else if (pattern.toString().includes('year')) {
        parsed.setFullYear(parsed.getFullYear() - amount);
      }
      return parsed;
    }
  }
  
  // Existing absolute date parsing...
  const formats = [
    // UK formats
    /(\d{1,2})\/(\d{1,2})\/(\d{4})/,  // DD/MM/YYYY
    /(\d{1,2})-(\d{1,2})-(\d{4})/,   // DD-MM-YYYY
    /(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i,
    /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/i,
    // ISO format
    /(\d{4})-(\d{1,2})-(\d{1,2})/,   // YYYY-MM-DD
  ];
  
  try {
    // First try built-in parsing
    const parsed = new Date(dateString);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
    
    // Try manual parsing for UK formats
    for (const format of formats) {
      const match = dateString.match(format);
      if (match) {
        if (format.toString().includes('January|February')) {
          // Month name format
          const day = parseInt(match[1]);
          const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                            'July', 'August', 'September', 'October', 'November', 'December'];
          const month = monthNames.findIndex(m => m.toLowerCase() === match[2].toLowerCase());
          const year = parseInt(match[3]);
          return new Date(year, month, day);
        } else if (format.toString().includes('Jan|Feb')) {
          // Short month format
          const day = parseInt(match[1]);
          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const month = monthNames.findIndex(m => m.toLowerCase() === match[2].toLowerCase());
          const year = parseInt(match[3]);
          return new Date(year, month, day);
        } else {
          // Numeric formats
          const day = parseInt(match[1]);
          const month = parseInt(match[2]) - 1; // JS months are 0-indexed
          const year = parseInt(match[3]);
          return new Date(year, month, day);
        }
      }
    }
  } catch (error) {
    console.error('Date parsing error:', error);
  }
  
  return null;
}

// Get current date in UK format for AI prompts
function getCurrentDateUK(): string {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/London'
  };
  return now.toLocaleDateString('en-GB', options);
}

// Extract date information from conversation
function extractDatesFromConversation(messages: Msg[]): { reportedDate: Date | null, issueType: string, childrenAffected: boolean } {
  const conversationText = messages.map(m => m.content).join(' ').toLowerCase();
  
  // Look for date patterns, including relatives
  let reportedDate: Date | null = null;
  const datePatterns = [
    /(?:reported|told|contacted|called|emailed|complained).*?(?:on|in|about)\s+([^.]+)/gi,
    /(?:first|initially|originally).*?(?:reported|contacted|told).*?(?:on|in|about)\s+([^.]+)/gi,
    /([^.]*(?:january|february|march|april|may|june|july|august|september|october|november|december)[^.]*)/gi,
    /([^.]*\d{1,2}\/\d{1,2}\/\d{4}[^.]*)/gi,
    /(\d+\s+(?:weeks?|months?|days?|years?)\s+ago)/gi,  // Added relative pattern
  ];
  
  for (const pattern of datePatterns) {
    const matches = conversationText.matchAll(pattern);
    for (const match of matches) {
      const dateStr = match[1];
      const parsed = parseDate(dateStr);
      if (parsed && !reportedDate) {
        reportedDate = parsed;
        break;
      }
    }
    if (reportedDate) break;
  }
  
  // Detect issue type
  let issueType = '';
  if (conversationText.includes('damp') || conversationText.includes('mould') || conversationText.includes('mold')) {
    issueType = 'damp_mould';
  } else if (conversationText.includes('repair') || conversationText.includes('leak') || conversationText.includes('broken')) {
    issueType = 'repairs';
  } else if (conversationText.includes('heating') || conversationText.includes('boiler') || conversationText.includes('cold')) {
    issueType = 'heating';
  } else {
    issueType = 'general';
  }
  
  // Detect children
  const childrenAffected = conversationText.includes('child') || conversationText.includes('baby') || 
                          conversationText.includes('infant') || conversationText.includes('kid') ||
                          conversationText.includes('toddler') || conversationText.includes('son') ||
                          conversationText.includes('daughter');
  
  return { reportedDate, issueType, childrenAffected };
}

// Calculate regulatory breaches with conditional checks for law enforcement dates
function calculateTimelineBreaches(reportedDate: Date, issueType: string, childrenAffected: boolean = false) {
  const today = new Date();
  const workingDaysElapsed = calculateWorkingDays(reportedDate, today);
  const calendarDaysElapsed = Math.floor((today.getTime() - reportedDate.getTime()) / (1000 * 60 * 60 * 24));
  
  const breaches = [];
  
  // Housing Ombudsman Code breaches
  if (workingDaysElapsed > 5) {
    breaches.push({
      regulation: "Housing Ombudsman Code Section 4.2",
      requirement: "acknowledge complaint within 5 working days",
      elapsed: workingDaysElapsed,
      unit: "working days",
      breached: true,
      severity: "moderate"
    });
  }
  
  if (workingDaysElapsed > 10) {
    breaches.push({
      regulation: "Housing Ombudsman Code Section 4.2", 
      requirement: "provide full response within 10 working days",
      elapsed: workingDaysElapsed,
      unit: "working days",
      breached: true,
      severity: "serious"
    });
  }
  
  // Awaab's Law for damp/mould with children - Conditional on enforcement date
  const awaabsLawEnforcementDate = new Date('2025-10-27');
  if (issueType === 'damp_mould' && childrenAffected && calendarDaysElapsed > 14 && today >= awaabsLawEnforcementDate) {
    breaches.push({
      regulation: "Social Housing Regulation Act 2023 (Awaab's Law)",
      requirement: "investigate damp and mould affecting children within 14 days",
      elapsed: calendarDaysElapsed,
      unit: "calendar days",
      breached: true,
      severity: "critical"
    });
  } else if (issueType === 'damp_mould' && childrenAffected && today < awaabsLawEnforcementDate) {
    breaches.push({
      regulation: "Social Housing Regulation Act 2023 (Awaab's Law)",
      requirement: "investigate damp and mould affecting children within 14 days (effective from October 27, 2025)",
      elapsed: calendarDaysElapsed,
      unit: "calendar days",
      breached: false,  // Not yet breached
      severity: "impending"
    });
  }
  
  // Emergency repair timeframes
  if (issueType === 'heating' && calendarDaysElapsed > 1) {
    breaches.push({
      regulation: "Section 11 of the Landlord and Tenant Act 1985",
      requirement: "complete emergency heating repairs within 24 hours",
      elapsed: calendarDaysElapsed,
      unit: "calendar days",
      breached: true,
      severity: "serious"
    });
  }
  
  // General repair timeframes
  if (issueType === 'repairs' && calendarDaysElapsed > 28) {
    breaches.push({
      regulation: "Section 11 of the Landlord and Tenant Act 1985",
      requirement: "complete non-emergency repairs within reasonable time (typically 28 days)",
      elapsed: calendarDaysElapsed,
      unit: "calendar days",
      breached: true,
      severity: "moderate"
    });
  }
  
  return {
    reportedDate,
    workingDaysElapsed,
    calendarDaysElapsed,
    breaches,
    hasBreaches: breaches.length > 0
  };
}

/* -------------------------- WEB SEARCH FUNCTIONS -------------------------- */

// General web search function
async function performWebSearch(query: string, context: string = 'general', maxResults = 3, dynamicDomains: string[] = []) {
  try {
    const tavilyApiKey = process.env.TAVILY_API_KEY;
    if (tavilyApiKey) {
      return await searchWithTavily(query, context, maxResults, dynamicDomains);
    }

    const serpApiKey = process.env.SERP_API_KEY;
    if (serpApiKey) {
      return await searchWithSerpAPI(query, context, maxResults);
    }

    const googleApiKey = process.env.GOOGLE_SEARCH_API_KEY;
    const googleCseId = process.env.GOOGLE_CSE_ID;
    if (googleApiKey && googleCseId) {
      return await searchWithGoogle(query, context, maxResults, googleApiKey, googleCseId);
    }

    console.warn('No web search API keys found - skipping web search');
    return [];
  } catch (error) {
    console.error('Web search failed:', error);
    return [];
  }
}

// Enhanced email extraction
function extractEmailsFromText(text: string): string[] {
  const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  return text.match(emailRegex) || [];
}

// Prioritize complaints-specific emails
function prioritizeComplaintsEmails(emails: string[]): string[] {
  const complaintKeywords = ['complaint', 'complaints', 'feedback', 'customer', 'service', 'help', 'support'];
  
  const complaintsEmails = emails.filter(email => 
    complaintKeywords.some(keyword => email.toLowerCase().includes(keyword))
  );
  
  const otherEmails = emails.filter(email => 
    !complaintKeywords.some(keyword => email.toLowerCase().includes(keyword)) &&
    !email.toLowerCase().includes('noreply') &&
    !email.toLowerCase().includes('no-reply')
  );
  
  return [...complaintsEmails, ...otherEmails];
}

// Tavily search with dynamic domains based on context
async function searchWithTavily(query: string, context: string, maxResults: number, dynamicDomains: string[] = []) {
  let includeDomains: string[] = dynamicDomains.length > 0 ? dynamicDomains : [];
  let searchQuery = query;

  switch (context) {
    case 'housing_association_contacts':
      searchQuery = `${query} complaints email address contact customer services`;
      if (!includeDomains.length) {
        includeDomains = [];  // Now dynamic, set externally
      }
      break;
    case 'housing_law':
      searchQuery = `UK housing law ${query}`;
      includeDomains = [
        'gov.uk', 'housing-ombudsman.org.uk', 'citizensadvice.org.uk',
        'shelter.org.uk', 'legislation.gov.uk', 'rightsnet.org.uk'
      ];
      break;
  }

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.TAVILY_API_KEY}`
    },
    body: JSON.stringify({
      query: searchQuery,
      search_depth: 'basic',
      include_domains: includeDomains.length > 0 ? includeDomains : undefined,
      max_results: maxResults
    })
  });

  if (!response.ok) {
    throw new Error(`Tavily search failed: ${response.status}`);
  }

  const data = await response.json();
  return data.results?.map((result: any) => ({
    title: result.title,
    url: result.url,
    content: result.content,
    context: context,
    source: 'web_search'
  })) || [];
}

// SerpAPI search with context
async function searchWithSerpAPI(query: string, context: string, maxResults: number) {
  let searchQuery = query;
  
  switch (context) {
    case 'housing_association_contacts':
      searchQuery = `"${query}" complaints email address contact`;
      break;
    case 'housing_law':
      searchQuery = `UK housing law ${query} site:gov.uk OR site:housing-ombudsman.org.uk`;
      break;
  }
  
  const response = await fetch(`https://serpapi.com/search?engine=google&q=${encodeURIComponent(searchQuery)}&api_key=${process.env.SERP_API_KEY}&num=${maxResults}`);

  if (!response.ok) {
    throw new Error(`SerpAPI search failed: ${response.status}`);
  }

  const data = await response.json();
  return data.organic_results?.map((result: any) => ({
    title: result.title,
    url: result.link,
    content: result.snippet,
    context: context,
    source: 'web_search'
  })) || [];
}

// Google Custom Search with context
async function searchWithGoogle(query: string, context: string, maxResults: number, apiKey: string, cseId: string) {
  let searchQuery = query;
  
  if (context === 'housing_association_contacts') {
    searchQuery = `"${query}" complaints email customer services contact`;
  } else if (context === 'housing_law') {
    searchQuery = `UK housing law ${query}`;
  }
  
  const response = await fetch(
    `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cseId}&q=${encodeURIComponent(searchQuery)}&num=${maxResults}`
  );

  if (!response.ok) {
    throw new Error(`Google search failed: ${response.status}`);
  }

  const data = await response.json();
  return data.items?.map((item: any) => ({
    title: item.title,
    url: item.link,
    content: item.snippet,
    context: context,
    source: 'web_search'
  })) || [];
}

// Enhanced function to search for housing association contact details with focused email search and domain validation
async function searchHousingAssociationContacts(housingAssociationName: string) {
  console.log(`🔍 Searching for ${housingAssociationName} contact details`);
  
  try {
    // Dynamic domains based on housing association name
    const nameLower = housingAssociationName.toLowerCase().replace(/\s+/g, '');
    const dynamicDomains = [`${nameLower}.com`, `${nameLower}.org.uk`, `${nameLower}.co.uk`];

    // Primary search for general contact info
    const generalResults = await performWebSearch(housingAssociationName, 'housing_association_contacts', 3, dynamicDomains);
    
    // Focused search specifically for complaints email
    const emailResults = await performWebSearch(
      `"${housingAssociationName}" complaints email address customer service`, 
      'housing_association_contacts', 
      2,
      dynamicDomains
    );
    
    const allResults = [...emailResults, ...generalResults].filter(result => 
      // Validate URL matches association name
      result.url.toLowerCase().includes(nameLower)
    );
    
    if (allResults.length === 0) {
      console.warn(`⚠️ No contact details found for ${housingAssociationName}`);
      return null;
    }

    let contactInfo = {
      name: housingAssociationName,
      email: null as string | null,
      complaintsEmail: null as string | null,
      phone: null as string | null,
      website: null as string | null,
      address: null as string | null
    };

    const phoneRegex = /(0\d{10}|0\d{4}\s?\d{3}\s?\d{3}|0\d{3}\s?\d{3}\s?\d{4})/g;

    // Process all results to extract contact information
    for (const result of allResults) {
      const text = `${result.title} ${result.content}`;
      
      // Extract all emails and prioritize complaints emails
      const emails = extractEmailsFromText(text);
      const prioritizedEmails = prioritizeComplaintsEmails(emails);
      
      // Set complaints email (highest priority)
      if (prioritizedEmails.length > 0 && !contactInfo.complaintsEmail) {
        contactInfo.complaintsEmail = prioritizedEmails[0];
      }
      
      // Set general email if no complaints email found
      if (emails.length > 0 && !contactInfo.email) {
        contactInfo.email = emails.find(email => !email.includes('noreply')) || emails[0];
      }

      // Extract phone numbers
      const phones = text.match(phoneRegex) || [];
      if (phones.length > 0 && !contactInfo.phone) {
        contactInfo.phone = phones[0] || null;
      }

      // Store website (prefer official domain)
      if (!contactInfo.website || result.url.includes(nameLower)) {
        contactInfo.website = result.url;
      }
    }

    // Use complaints email as primary email if found
    if (contactInfo.complaintsEmail && !contactInfo.email) {
      contactInfo.email = contactInfo.complaintsEmail;
    }

    console.log(`✅ Found contact info for ${housingAssociationName}:`, contactInfo);
    return contactInfo;
    
  } catch (error) {
    console.error(`❌ Error searching for ${housingAssociationName} contacts:`, error);
    return null;
  }
}

function windowMessages(messages: Msg[], maxChars = 9000) {
  const trimmed: Msg[] = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    total += (m.content || '').length;
    trimmed.unshift(m);
    if (total > maxChars) break;
  }
  return trimmed;
}

function latestUserText(messages: Msg[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].content || '';
  }
  return '';
}

// Dynamic legislation discovery based on conversation issues
async function searchRelevantLegislation(conversationContext: string) {
  try {
    console.log('🔍 Searching for relevant housing legislation...');
    
    const contextLower = conversationContext.toLowerCase();
    const legislationSearches = [];
    
    // Build dynamic search queries based on actual issues mentioned
    if (contextLower.includes('damp') || contextLower.includes('mould') || contextLower.includes('mold')) {
      legislationSearches.push(
        'UK damp mould legislation 2023 2024 2025 children housing law',
        'Social Housing Regulation Act damp mould investigation timeline',
        'Awaab\'s Law enforcement date damp mould children'
      );
    }
    
    if (contextLower.includes('repair') || contextLower.includes('leak') || contextLower.includes('broken')) {
      legislationSearches.push(
        'UK housing repair legislation obligations landlord 2023 2024',
        'Homes Fitness Human Habitation Act repair obligations',
        'Housing Act repair notices enforcement recent updates'
      );
    }
    
    if (contextLower.includes('heating') || contextLower.includes('boiler') || contextLower.includes('cold')) {
      legislationSearches.push(
        'UK heating emergency repair legislation timeline obligations',
        'excess cold housing hazard Category 1 recent updates',
        'emergency heating repair legal requirements landlord'
      );
    }
    
    if (contextLower.includes('complaint') || contextLower.includes('response') || contextLower.includes('timeline')) {
      legislationSearches.push(
        'Housing Ombudsman Code 2023 2024 complaint handling timeline',
        'Consumer Standards complaint response obligations recent',
        'housing complaint legislation update timeline requirements'
      );
    }
    
    // Always search for general housing legislation updates
    legislationSearches.push(
      'UK housing legislation updates 2024 2025 tenant rights',
      'recent housing law changes social housing regulation'
    );
    
    const allResults = [];
    
    // Perform focused searches
    for (const searchQuery of legislationSearches) {
      const webResults = await performWebSearch(searchQuery, 'housing_law', 3);
      allResults.push(...webResults);
    }
    
    console.log(`✅ Found ${allResults.length} potential legislation sources`);
    return allResults;
    
  } catch (error) {
    console.error('Legislation search error:', error);
    return [];
  }
}

// Enhanced semantic search function for legal knowledge with aggressive cross-referencing
async function searchLegalKnowledge(query: string, conversationContext: string = '', limit = 12) {
  try {
    // Combine query with conversation context for better matching
    const searchText = `${query} ${conversationContext}`.slice(0, 1000);
    
    // Get embedding for the query
    const embedding = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: searchText,
    });

    // Primary search with relaxed threshold
    const { data, error } = await supabase.rpc('match_documents', {
      query_embedding: embedding.data[0].embedding,
      match_threshold: 0.5, // More permissive to get more sources
      match_count: limit
    });

    if (error) {
      console.error('Legal search error:', error);
      return [];
    }

    let results = data || [];

    // AGGRESSIVE CROSS-REFERENCING: Search for all related legal areas
    const queryLower = query.toLowerCase();
    const contextLower = conversationContext.toLowerCase();
    const combinedText = `${queryLower} ${contextLower}`;
    
    const crossReferenceSearches = [];
    
    // For ANY housing issue, always include these core areas
    crossReferenceSearches.push(
      // Housing Ombudsman Code - always relevant for complaints
      openai.embeddings.create({
        model: "text-embedding-3-small",
        input: "Housing Ombudsman Code complaint handling timeline response landlord obligations compensation remedies",
      }),
      // Section 11 duties - fundamental repair obligations
      openai.embeddings.create({
        model: "text-embedding-3-small", 
        input: "Section 11 Landlord Tenant Act 1985 repair obligations structure exterior",
      }),
      // Fitness for habitation
      openai.embeddings.create({
        model: "text-embedding-3-small",
        input: "Homes Fitness Human Habitation Act 2018 landlord duties standards",
      })
    );
    
    // Issue-specific cross-referencing
    if (combinedText.includes('damp') || combinedText.includes('mould') || combinedText.includes('mold') || 
        combinedText.includes('condensation') || combinedText.includes('baby') || combinedText.includes('child')) {
      crossReferenceSearches.push(
        openai.embeddings.create({
          model: "text-embedding-3-small",
          input: "Awaab's Law Social Housing Regulation Act 2023 damp mould investigation timeline children",
        }),
        openai.embeddings.create({
          model: "text-embedding-3-small",
          input: "HHSRS Health Safety Rating System Category 1 hazards damp excess cold",
        }),
        openai.embeddings.create({
          model: "text-embedding-3-small",
          input: "Housing Act 1985 Section 9A hazard assessment disrepair notice",
        })
      );
    }

    if (combinedText.includes('repair') || combinedText.includes('maintenance') || combinedText.includes('broken')) {
      crossReferenceSearches.push(
        openai.embeddings.create({
          model: "text-embedding-3-small",
          input: "Landlord Tenant Act 1985 repair covenants implied terms structure exterior",
        }),
        openai.embeddings.create({
          model: "text-embedding-3-small",
          input: "Housing Act 1985 fitness standard repair notice enforcement",
        }),
        openai.embeddings.create({
          model: "text-embedding-3-small",
          input: "Defective Premises Act 1972 landlord duty care safety",
        })
      );
    }

    if (combinedText.includes('heating') || combinedText.includes('boiler') || combinedText.includes('cold')) {
      crossReferenceSearches.push(
        openai.embeddings.create({
          model: "text-embedding-3-small",
          input: "HHSRS excess cold Category 1 hazard heating systems emergency repair",
        }),
        openai.embeddings.create({
          model: "text-embedding-3-small",
          input: "Section 11 Landlord Tenant Act heating installations emergency timeline",
        })
      );
    }

    if (combinedText.includes('noise') || combinedText.includes('antisocial') || combinedText.includes('neighbour')) {
      crossReferenceSearches.push(
        openai.embeddings.create({
          model: "text-embedding-3-small",
          input: "antisocial behaviour landlord duty tenancy conditions quiet enjoyment",
        }),
        openai.embeddings.create({
          model: "text-embedding-3-small",
          input: "Housing Act 1996 antisocial behaviour noise nuisance landlord obligations",
        })
      );
    }

    // Always include compensation and enforcement
    crossReferenceSearches.push(
      openai.embeddings.create({
        model: "text-embedding-3-small",
        input: "Housing Ombudsman compensation remedies maladministration service failure awards",
      }),
      openai.embeddings.create({
        model: "text-embedding-3-small",
        input: "Regulator Social Housing Consumer Standards enforcement landlord obligations",
      })
    );

    // Execute all cross-reference searches in parallel
    const crossReferenceEmbeddings = await Promise.all(crossReferenceSearches);
    
    // Search for each cross-reference area
    for (const embeddingResponse of crossReferenceEmbeddings) {
      const { data: crossRefData } = await supabase.rpc('match_documents', {
        query_embedding: embeddingResponse.data[0].embedding,
        match_threshold: 0.4, // Even more permissive for cross-referencing
        match_count: 3
      });

      if (crossRefData) {
       const existingIds = new Set(results.map((r: any) => r.id));
        const newDocs = crossRefData.filter((doc: any) => !existingIds.has(doc.id));
        results = [...results, ...newDocs];
      }
    }

    // Return comprehensive results (more sources for better cross-referencing)
    return results.slice(0, limit + 8);
  } catch (error) {
    console.error('Legal search failed:', error);
    return [];
  }
}

// Format legal context for prompts with comprehensive coverage and timeline breaches
function formatLegalContext(legalDocs: any[], timelineAnalysis: any = null): string {
  const currentDate = getCurrentDateUK();
  
  if (!legalDocs.length && !timelineAnalysis) {
    console.warn('⚠️ No legal documents or timeline analysis found');
    return '';
  }
  
  console.log(`📚 Formatting ${legalDocs.length} legal documents for AI context`);
  
  let context = `CURRENT DATE: ${currentDate} - Use this for all date references and calculations.\n\n`;
  
  // Add timeline breach analysis if available
  if (timelineAnalysis && timelineAnalysis.hasBreaches) {
    context += `🚨 CRITICAL TIMELINE BREACH ANALYSIS:\n`;
    context += `Report Date: ${timelineAnalysis.reportedDate.toDateString()}\n`;
    context += `Current Date: ${currentDate}\n`;
    context += `Working Days Elapsed: ${timelineAnalysis.workingDaysElapsed}\n`;
    context += `Calendar Days Elapsed: ${timelineAnalysis.calendarDaysElapsed}\n\n`;
    context += `REGULATORY BREACHES IDENTIFIED:\n`;
    
    timelineAnalysis.breaches.forEach((breach: any, i: number) => {
      context += `${i + 1}. ${breach.regulation}\n`;
      context += `   Required: ${breach.requirement}\n`;
      context += `   Elapsed: ${breach.elapsed} ${breach.unit} (${breach.breached ? 'BREACH' : 'IMPENDING'})\n`;
      context += `   Severity: ${breach.severity.toUpperCase()}\n\n`;
    });
    
    context += `IMPORTANT: These timeline breaches must be prominently featured in any complaint letter as they provide concrete evidence of regulatory non-compliance.\n\n`;
  }
  
  // Add legal documents
  if (legalDocs.length > 0) {
    // Separate legislation updates from other sources
    const legislationSources = legalDocs.filter(doc => doc.metadata?.source === 'legislation_search');
    const otherSources = legalDocs.filter(doc => doc.metadata?.source !== 'legislation_search');
    
    let sourcesContext = '';
    
    // Prioritize recent legislation updates
    if (legislationSources.length > 0) {
      sourcesContext += `\n🚨 RECENT LEGISLATION UPDATES (${legislationSources.length} sources):\n`;
      sourcesContext += legislationSources
        .map((doc, i) => `[LEGISLATION UPDATE ${i + 1}]\nFrom: ${doc.metadata?.url || 'Unknown'}\n${doc.content}`)
        .join('\n\n');
      sourcesContext += '\n\nIMPORTANT: These are recent/current legislative updates that must be prominently referenced if relevant to the case.\n';
    }
    
    // Then add other legal knowledge
    if (otherSources.length > 0) {
      sourcesContext += `\n📚 ESTABLISHED LEGAL KNOWLEDGE (${otherSources.length} sources):\n`;
      sourcesContext += otherSources
        .map((doc, i) => `[LEGAL SOURCE ${i + 1}]\nFrom: ${doc.metadata?.source || 'Unknown'}\n${doc.content}`)
        .join('\n\n');
    }
      
    context += sourcesContext + `\n\nUSE THIS LEGAL KNOWLEDGE extensively with specific citations. Always reference exact legal provisions, timeframes, and obligations. For example: "Under Section 11 of the Landlord and Tenant Act 1985, they must..." or "The Housing Ombudsman Code Section 4.2 requires response within 10 working days" or "Awaab's Law (Social Housing Regulation Act 2023) mandates investigation within 14 days". Cross-reference multiple sources to build the strongest possible legal case. Be precise about which laws apply and what the exact requirements are. MANDATORY: Every legal claim must cite 2-3 different statutory authorities minimum. Build layered arguments showing how issues violate multiple regulations simultaneously.`;
  }
  
  return context;
}

// Deterministic language detection (improved to avoid false switches on names/addresses)
async function detectUserLang(text: string): Promise<{ code: string; name: string }> {
  if (!text.trim()) return { code: 'en', name: 'English' };
  
  const trimmed = text.trim();
  
  // Don't detect on very short text unless it contains clear language indicators
  if (trimmed.length < 10) {
    // Allow detection for clear greetings/language words even if short
    const languageWords = ['salut', 'hola', 'bonjour', 'guten', 'ciao', 'buongiorno', 'buenos'];
    const hasLanguageWord = languageWords.some(word => trimmed.toLowerCase().includes(word));
    if (!hasLanguageWord) {
      return { code: 'en', name: 'English' };
    }
  }
  
  // Skip detection if text looks like names, addresses, or proper nouns
  const words = trimmed.split(/\s+/);
  if (words.length <= 3) {
    // Check if it looks like a name (mostly capitalized words)
    const capitalizedWords = words.filter(word => /^[A-Z][a-z]+$/.test(word));
    if (capitalizedWords.length === words.length && words.length >= 2) {
      return { code: 'en', name: 'English' }; // Likely a name like "John Smith"
    }
    
    // Check if it looks like an address pattern
    const hasNumbers = /\d/.test(trimmed);
    const hasAddressWords = /\b(street|road|avenue|lane|drive|close|way|court|place|st|rd|ave)\b/i.test(trimmed);
    if (hasNumbers && hasAddressWords) {
      return { code: 'en', name: 'English' }; // Likely an address
    }
  }
  
  const det = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          'Return ONLY JSON like {"code":"xx","name":"LanguageName"} with ISO 639-1 code for the dominant language of the user text. If uncertain or if text is very short/just names, return English.',
      },
      { role: 'user', content: text.slice(0, 2000) },
    ],
    response_format: { type: 'json_object' as const },
  });

  try {
    const raw = det.choices[0]?.message?.content?.trim() || '{}';
    const parsed = JSON.parse(raw);
    const code = String(parsed.code || '').toLowerCase();
    const name = String(parsed.name || '');
    if (code && name) return { code, name };
  } catch {}
  return { code: 'en', name: 'English' };
}

// One-time banner translated to the user's language
async function translateOneTimeBanner(targetLangName: string) {
  const englishBanner =
    "No problem — we can continue in your language. When you're ready to write the letter, I'll produce it in English for your landlord and include a translation in your language.\n\nI use the latest Housing Ombudsman Code, legislation, and regulatory guidance (including 2024 updates), so my answers are based on the most up‑to‑date information from official sources you can verify.";
  const tr = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: `Translate the following into ${targetLangName}. Keep it polite, concise, neutral. Return only the translated text.`,
      },
      { role: 'user', content: englishBanner },
    ],
  });
  return (tr.choices[0]?.message?.content || englishBanner).trim();
}

/* -------------------------- IMPROVED CONVERSATION PROMPTS -------------------------- */

function createGuidedChatPrompt(userLangCode: string, userLangName: string, isEnglish: boolean, legalContext: string) {
  const currentDate = getCurrentDateUK();
  
  return `
You are a warm, empathetic housing complaint expert who guides people naturally through creating powerful complaint letters. You feel like talking to a knowledgeable friend who happens to be a housing law specialist.

CURRENT DATE: ${currentDate}

Your personality:
- Genuinely caring and supportive - housing problems are really stressful
- You validate people's feelings first, then provide expert legal guidance
- Natural conversationalist who guides people step by step
- Expert in UK housing law with precise knowledge of statutes and timeframes
- You act as their advocate, building the strongest possible case
- When providing explanations or informal responses, you may use friendly emojis (like 😺 or ✉️) to make it clearer. But use sparingly and appropriately, not when the conversation is serious. Nothing 
- you are patient and never rush people

Your approach to information gathering:
- NEVER ask for multiple pieces of information at once
- Guide people naturally through ONE question at a time (or logical pairs like name + address)
- Make ALL information optional: "Don't worry if you'd rather not share - I can use placeholders"
- Explain WHY you're asking: "This helps make the legal case stronger because..."
- Let the conversation flow naturally - don't rush through a checklist
- If they don't want to answer something, move on gracefully
- **EXERCISE DISCRETION**: If someone mentions sensitive work details, personal circumstances, or private information, use generic language in letters while acknowledging their situation conversationally
- **PROTECT PRIVACY**: Always sanitize sensitive details for formal letters - use "unable to work from home" instead of specific job types, "family circumstances" instead of personal details, etc.

When someone wants to write a complaint letter:
- Say you'll "guide them through" getting the details needed
- Explain you're building a legally robust case with specific statutory citations
- Ask ONE question at a time, making each optional
- Focus on the legal strength you're building, not data collection

Your legal expertise with AGGRESSIVE cross-referencing:
- **MANDATORY MULTIPLE CITATIONS**: Every legal point must reference 2-3 different sources minimum
- Draw from ALL available legal knowledge - use the comprehensive source base extensively  
- **EXACT STATUTORY REFERENCES**: Always cite precise sections: "Section 11(1)(a) of the Landlord and Tenant Act 1985", "Housing Ombudsman Code paragraph 4.2.1", "Social Housing Regulation Act 2023 Section 97A (Awaab's Law)"
- **LAYERED LEGAL ARGUMENTS**: Build cases with multiple legal foundations:
  * Repair issues: Section 11 LTA 1985 + Homes (Fitness) Act 2018 + Housing Act 1985 s9A + HHSRS
  * Damp/mould: Awaab's Law + Section 11 + Fitness for Habitation + HHSRS Category 1 hazards
  * Complaints: Ombudsman Code + Consumer Standards + statutory response duties + remedies guidance
- **CROSS-REFERENCE ENFORCEMENT**: Connect multiple enforcement routes (Ombudsman, Regulator, courts, local authority)
- **PRECISE TIMEFRAMES WITH MULTIPLE AUTHORITIES**: "10 working days under Housing Ombudsman Code Section 4.2, which aligns with the Regulator's Consumer Standards expectations"
- **IDENTIFY BREACH PATTERNS**: Show how single issues violate multiple regulations simultaneously
- **COMBINE PRIMARY + SECONDARY LAW**: Use Acts of Parliament alongside codes, standards, and guidance together

Example cross-referencing style:
"This violates Section 11 of the Landlord and Tenant Act 1985 (structure/exterior duty), the Homes (Fitness for Human Habitation) Act 2018 (habitability standard), AND constitutes a Category 1 hazard under HHSRS requiring action under Housing Act 1985 Section 9A, while also breaching Housing Ombudsman Code timeline requirements and Consumer Standards."

Timeline awareness and breach detection:
- When dates are mentioned, automatically calculate if any regulatory timelines have been breached
- If timeline breaches are detected, emphasize their legal significance
- Explain how timeline breaches strengthen the complaint case
- Reference the specific regulations that have been violated

Compensation guidance:
- NEVER ask residents to specify compensation amounts
- Reference Housing Ombudsman remedies guidance for appropriate compensation
- Suggest compensation ranges based on issue severity and impact:
  * Minor inconvenience: £50-£150
  * Moderate impact: £150-£600  
  * Serious impact: £600-£1,500
  * Severe impact with health consequences: £1,500-£5,000+
- Focus on "appropriate compensation in accordance with Housing Ombudsman remedies guidance"
- Mention specific impacts that warrant compensation (health, distress, time and trouble, alternative accommodation costs)

Conversation style examples:

When they want help writing a letter:
"Absolutely - I'm going to help you create a really powerful complaint letter that cites all the exact legal requirements they're breaking. Since you mentioned damp and mould with a baby involved, we can reference Awaab's Law (Social Housing Regulation Act 2023) which gives you really strong protections.

Let me guide you through this step by step. First, what's your name? (Don't worry if you'd rather keep it private - I can just use '[Your name]' as a placeholder in the letter)"

When they provide information:
"Perfect, thanks Sarah. Now I need the housing association details for the letter. What's the name of your housing association? (I'll look up their current complaints email address so your letter goes to the right department)"

After getting housing association name:
"Great, let me quickly find [Housing Association]'s current complaints email address... [searches automatically] Perfect - I found their complaints contact details. Now for your address - this goes at the top of the letter as the sender. What's your address? (Don't worry if you'd rather use a placeholder like '[Your address]' for privacy)"

When asking about the issue:
"Great. You mentioned damp and mould affecting your baby's room - when did you first report this to them? This is important because under Awaab's Law, they have just 14 days to investigate when children are affected, so we can show exactly how long they've been breaching their legal obligations."

When timeline breaches are detected:
"This is really significant - it's been [X] working days since you first reported this, which means they've already breached the Housing Ombudsman Code requirement for a response within 10 working days. This actually strengthens your case considerably because you now have concrete evidence of regulatory non-compliance."

When they mention work impact:
"I understand this is also affecting your ability to work - that's important for showing the full impact. For the letter, I'll keep the work details general to maintain your privacy - I'll mention that the conditions are preventing you from working and the financial impact, which strengthens your case for compensation."

When discussing compensation:
"Based on what you've described, this would likely warrant compensation under Housing Ombudsman guidance. For an issue of this severity with health impacts, the typical range would be £600-£1,500, though the exact amount depends on the full impact assessment. I'll include a request for appropriate compensation in accordance with Housing Ombudsman remedies guidance."

NEVER create numbered lists in conversation. NEVER ask multiple questions at once. ALWAYS make information optional. ALWAYS explain the legal significance.

Language: Always respond in ${userLangName} (${userLangCode}). Be natural and conversational.

POLICY ABOUT SOURCES & FRESHNESS
- If asked how current your info is, reply naturally: "I use the latest Housing Ombudsman Code, legislation, and regulatory guidance (including 2024 updates), plus I have access to current legal databases, so my information includes the most recent statutory requirements and ombudsman guidance."

Remember: You're not collecting data - you're building a legally powerful case while being genuinely supportive. Guide them naturally, one step at a time, making everything optional and explaining the legal strength you're building.

${legalContext}
`.trim();
}

function createLegallyRobustLetterPrompt(userLangCode: string, userLangName: string, isEnglish: boolean, legalContext: string) {
  const currentDate = getCurrentDateUK();
  
  return `
You are an expert at writing legally robust, compelling UK housing complaint letters that get results. You combine precise legal knowledge with persuasive writing to create letters that landlords cannot ignore.

CURRENT DATE: ${currentDate}
Use this exact date in UK format for the letter headers.

Your approach:
- Write letters that sound professional but human - like they're from an educated, articulate resident who knows their exact legal rights
- Include specific statutory citations with exact sections and acts
- Reference precise timeframes with legal authority
- Tell a compelling story that shows both the problem and the landlord's specific legal breaches
- Be firm and assertive while remaining respectful and solution-focused
- **PROTECT PRIVACY**: Use professional, generic language for work, personal circumstances, and sensitive details - "unable to work from home" not specific job types, "family circumstances" not personal details
- **MAINTAIN DISCRETION**: Keep letters focused on housing issues and impacts, not personal lifestyle details

Legal precision requirements - AGGRESSIVE CROSS-REFERENCING MANDATORY:
- **MANDATORY MULTIPLE CITATIONS**: Every legal point must reference 2-3 different sources minimum
- Draw from ALL available legal knowledge - use the comprehensive source base extensively  
- **EXACT STATUTORY REFERENCES**: Always cite precise sections: "Section 11(1)(a) of the Landlord and Tenant Act 1985", "Housing Ombudsman Code paragraph 4.2.1", "Social Housing Regulation Act 2023 Section 97A (Awaab's Law)"
- **LAYERED LEGAL ARGUMENTS**: Build cases with multiple legal foundations:
  * Repair issues: Section 11 LTA 1985 + Homes (Fitness) Act 2018 + Housing Act 1985 s9A + HHSRS
  * Damp/mould: Awaab's Law + Section 11 + Fitness for Habitation + HHSRS Category 1 hazards
  * Complaints: Ombudsman Code + Consumer Standards + statutory response duties + remedies guidance
- **CROSS-REFERENCE ENFORCEMENT**: Connect multiple enforcement routes (Ombudsman, Regulator, courts, local authority)
- **PRECISE TIMEFRAMES WITH MULTIPLE AUTHORITIES**: "10 working days under Housing Ombudsman Code Section 4.2, which aligns with the Regulator's Consumer Standards expectations"
- **IDENTIFY BREACH PATTERNS**: Show how single issues violate multiple regulations simultaneously
- **COMBINE PRIMARY + SECONDARY LAW**: Use Acts of Parliament alongside codes, standards, and guidance together

Example cross-referencing style:
"This violates Section 11 of the Landlord and Tenant Act 1985 (structure/exterior duty), the Homes (Fitness for Human Habitation) Act 2018 (habitability standard), AND constitutes a Category 1 hazard under HHSRS requiring action under Housing Act 1985 Section 9A, while also breaching Housing Ombudsman Code timeline requirements and Consumer Standards."

MANDATORY CROSS-REFERENCING EXAMPLES:
- Repairs: "Section 11 Landlord and Tenant Act 1985 + Homes (Fitness) Act 2018 + Housing Act 1985 s9A + HHSRS Category 1"
- Damp/mould: "Awaab's Law Section 97A + Section 11 LTA 1985 + Fitness for Habitation + HHSRS hazard assessment + Ombudsman Code timelines"
- Complaints: "Housing Ombudsman Code Section 4.2 + Consumer Standards + statutory complaint duties + remedies guidance + Regulator enforcement"

Each paragraph must weave together multiple legal sources to create legally unassailable arguments.
- Reference compensation with authority: "Housing Ombudsman remedies guidance provides for compensation of £[appropriate range] for [specific impact type]"
- Include compensation requests based on impact severity:
  * Minor inconvenience: £50-£150
  * Moderate impact: £150-£600
  * Serious impact: £600-£1,500
  * Severe impact: £1,500-£5,000+
- NEVER ask residents for compensation amounts - calculate appropriate ranges based on impact described
- Always cross-reference multiple authorities: "This breach of Section 11 LTA 1985, combined with Housing Ombudsman Code violations and Consumer Standards failures, warrants compensation under Ombudsman remedies guidance"

Timeline breach integration:
- When timeline breaches are identified in the legal context, prominently feature them in the letter
- Use timeline breaches as concrete evidence of regulatory non-compliance
- Structure the timeline breach section prominently, typically in the second or third paragraph
- Calculate and state exact days elapsed with reference to specific regulatory requirements

Letter structure and formatting requirements:
- **Email format (preferred)**: If complaints email found, format as email with To:/Subject: headers
- **Postal format**: If no email, use traditional letter layout
- **Sender's details**: Your details at top (use placeholders if not provided)
- **Date**: Use ${currentDate} for the date in letters
- **Recipient's details**: Housing association details (use found email/address or placeholders)
- **Subject line**: Clear, assertive subject
- **Body**: Professional chronology showing pattern of landlord failures with specific statutory breaches
- **Timeline breach section**: Dedicated paragraph highlighting regulatory violations
- **Closing**: Professional sign-off with sender's name

CRITICAL: Prioritize email format if complaints email address was found. Keep sender and recipient details clearly separated.

EXAMPLE EMAIL FORMAT:
To: complaints@housingassociation.com
Subject: Formal Complaint - Breach of Awaab's Law and Housing Ombudsman Code - [Property Address]

[Your name]
[Your address]
[Date]

Dear [Housing Association],

[Opening paragraph]

REGULATORY TIMELINE BREACHES:
It has now been [X] working days since I first reported this issue on [date], which significantly exceeds:
- The 5 working day acknowledgment requirement under Housing Ombudsman Code Section 4.2
- The 10 working day response requirement under Housing Ombudsman Code Section 4.2
- [Any other specific breaches]

[Continue with detailed complaint and legal citations]

Yours sincerely,
[Your name]

EXAMPLE POSTAL FORMAT:
[Your name]
[Your address]
[Your postcode]

${currentDate}

[Housing Association Name]
[Housing Association Address]
[Housing Association Postcode]

Subject: [Subject line]

Dear [Name],

[Same structure as email format]

Special requirements by issue type:
- Damp/mould with children: Prominently cite Awaab's Law (Social Housing Regulation Act 2023) and 14-day investigation requirement
- Emergency repairs: Section 11 Landlord and Tenant Act 1985 and 24-hour requirement
- Complaint handling: Housing Ombudsman Code Section 4.2 - 5 days acknowledgment, 10 days response
- Health hazards: Section 9A Housing Act 1985 and HHSRS Category 1 obligations

Compensation requirements:
- NEVER include specific amounts requested by residents
- Calculate appropriate compensation ranges based on impact described:
  * Minor issues: "compensation of £50-£150 for time and trouble"
  * Moderate impact: "compensation of £150-£600 for inconvenience and distress" 
  * Serious impact: "compensation of £600-£1,500 for significant impact on daily life"
  * Severe impact: "compensation of £1,500-£5,000+ for serious health consequences"
- Always phrase as: "appropriate compensation in accordance with Housing Ombudsman remedies guidance"
- Reference specific impacts: health effects, inability to use rooms, alternative accommodation costs, time off work
- Cross-reference with breach evidence: "Given the clear breaches of Section 11 LTA 1985, Housing Ombudsman Code Section 4.2, and [other violations], compensation is warranted under Ombudsman remedies guidance"

If essential details are missing, provide a brief, friendly explanation in ${userLangName} and create the best letter possible with available information, using appropriate placeholders.

Language handling:
- Create the English letter first (for the landlord)
- ${isEnglish ? '' : `Also provide a faithful translation in ${userLangName}`}
- Both versions should sound natural and authoritative in their respective languages

Output ONLY valid JSON (no Markdown code fences) with these fields:
{
  "intro": "ONE short sentence in ${userLangName}.",
  "letter_en_text": "A professional UK complaint letter formatted as EMAIL (if complaints email found) or POSTAL letter with PROPER FORMATTING. Include: [EMAIL: To: email, Subject: line] OR [POSTAL: full address blocks], [TIMELINE BREACH SECTION highlighting specific regulatory violations with exact days elapsed], [BODY with SPECIFIC STATUTORY CITATIONS], [PROFESSIONAL CLOSING]. Use placeholders for missing details. **PRIVACY PROTECTION**: Use generic, professional language. No markdown or asterisks.",
  "letter_en_markdown": "The SAME letter as 'letter_en_text' but formatted in MARKDOWN with PROPER LAYOUT and **bold emphasis** for statutory references, timeline breaches, and key legal points. Ensure visual clarity of timeline breach section. **PRIVACY PROTECTION**: Use generic, professional language.",
  "footer": "ONE short sentence in ${userLangName} explaining they can ask for edits.",
  ${isEnglish ? '' : `"letter_translation_text": "Faithful translation of the English letter into ${userLangName}, plain text only, maintaining all statutory references and legal precision.",
  "letter_translation_markdown": "The SAME as 'letter_translation_text' but with the same markdown emphasis as the English version, translated."`}
}

Remember: The letter must be legally bulletproof with AGGRESSIVE CROSS-REFERENCING of multiple statutory citations, exact timeframes, overlapping legal obligations, and prominently featured timeline breaches. Every paragraph must weave together multiple legal sources. Make it impossible for the landlord to ignore or dismiss. Use ALL available legal context extensively - reference Housing Ombudsman Code sections, specific Acts of Parliament with exact sections, regulatory standards, enforcement mechanisms, compensation guidance, and timeline requirements. Build layered arguments that show multiple legal breaches simultaneously.

${legalContext}
`.trim();
}

/* -------------------------- MAIN HANDLER -------------------------- */

export async function POST(req: NextRequest) {
  try {
    // Expect JSON: { messages, draft }
    const body = await req.json().catch(() => ({}));
    const messages: Msg[] = Array.isArray(body.messages) ? body.messages : [];
    const draft: boolean = Boolean(body.draft); // false = CHAT phase, true = LETTER phase

    const history = windowMessages(messages);
    const latest = latestUserText(history);

    // Extract timeline information from conversation - AUTOMATIC BREACH DETECTION
    const timelineInfo = extractDatesFromConversation(history);
    let timelineAnalysis = null;
    
    if (timelineInfo.reportedDate) {
      timelineAnalysis = calculateTimelineBreaches(
        timelineInfo.reportedDate, 
        timelineInfo.issueType, 
        timelineInfo.childrenAffected
      );
      console.log('📅 TIMELINE BREACH ANALYSIS:', timelineAnalysis);
    } else {
      console.log('🔍 No dates detected in conversation for timeline analysis');
    }

    // Search legal knowledge based on user's query AND conversation context - GET MORE SOURCES FOR CROSS-REFERENCING
    const conversationContext = history.map(m => m.content).join(' ');
    const legalDocs = latest ? await searchLegalKnowledge(latest, conversationContext, 15) : [];
    const legalContext = formatLegalContext(legalDocs, timelineAnalysis);

    // Detect language of latest user message
    const { code: userLangCode, name: userLangName } = await detectUserLang(latest);
    const isEnglish = userLangCode === 'en';

    // Show the translated banner exactly once: only if not English AND this is the first assistant reply
    const assistantCount = history.filter((m) => m.role === 'assistant').length;
    const shouldPrependBanner = !isEnglish && assistantCount === 0;

    /* ---------------------- CHAT phase (guided conversation) ---------------------- */
    if (!draft) {
      const systemPrompt = createGuidedChatPrompt(userLangCode, userLangName, isEnglish, legalContext);

      const modelStream = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.7, // Higher temperature for more natural responses
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Conversation phase: CHAT; UserLang=${userLangCode} (${userLangName}); IsEnglish=${isEnglish}` },
          ...history,
        ],
        stream: true,
      });

      const encoder = new TextEncoder();

      const readable = new ReadableStream({
        async start(controller) {
          try {
            if (shouldPrependBanner) {
              const translated = await translateOneTimeBanner(userLangName);
              controller.enqueue(encoder.encode(translated + '\n\n'));
            }
            for await (const chunk of modelStream) {
              const delta = chunk.choices?.[0]?.delta?.content || '';
              if (delta) controller.enqueue(encoder.encode(delta));
            }
          } catch (error) {
            console.error('Chat stream error:', error);
            controller.enqueue(encoder.encode('\n\n[Error generating response]\n'));
          } finally {
            controller.close();
          }
        },
      });

      return new Response(readable, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    /* ---------------------- LETTER phase (legally robust with contact search) ---------------------- */

    // Extract housing association name for contact search
    let housingAssociationName = '';
    let contactInfo = null;
    
    // Look for housing association mentions in conversation
    const conversationText = history.map(m => m.content).join(' ');
    const housingAssociationPatterns = [
      /(?:housing association|landlord|housing provider).*?(?:is|called|named)\s+([^.]+)/gi,
      /([^.\s]+\s*(?:housing|homes|group|living))/gi,
      /(clarion|peabody|guinness|sanctuary|riverside|places for people|notting hill|wandle)/gi
    ];
    
    for (const pattern of housingAssociationPatterns) {
      const matches = conversationText.matchAll(pattern);
      for (const match of matches) {
        const potential = match[1]?.trim();
        if (potential && potential.length > 2 && potential.length < 50) {
          housingAssociationName = potential;
          break;
        }
      }
      if (housingAssociationName) break;
    }
    
    // Search for contact details if housing association identified
    if (housingAssociationName) {
      console.log(`🔍 Searching contacts for: ${housingAssociationName}`);
      contactInfo = await searchHousingAssociationContacts(housingAssociationName);
    }

    // DYNAMIC LEGISLATION SEARCH - Find all relevant laws for this case
    console.log('🔍 Performing dynamic legislation search for letter...');
    const legislationResults = await searchRelevantLegislation(conversationContext);
    
    // Enhanced legal knowledge search with additional legislation context
    const enhancedLegalDocs = latest ? await searchLegalKnowledge(latest, conversationContext, 15) : [];
    
    // Combine all legal sources
    const allLegalSources = [...enhancedLegalDocs];
    if (legislationResults.length > 0) {
      allLegalSources.push(...legislationResults.map(result => ({
        id: `legislation_${result.url}`,
        content: `Recent Legislation Update: ${result.content}`,
        metadata: { source: 'legislation_search', url: result.url }
      })));
    }
    
    const enhancedLegalContext = formatLegalContext(allLegalSources, timelineAnalysis);
    // Add contact information to legal context
    let finalLegalContext = enhancedLegalContext;
    if (contactInfo) {
      finalLegalContext += `\n\nHOUSING ASSOCIATION CONTACT INFORMATION FOUND:
Name: ${contactInfo.name}
Complaints Email: ${contactInfo.complaintsEmail || contactInfo.email || 'Not found'}
Phone: ${contactInfo.phone || 'Not found'}
Website: ${contactInfo.website || 'Not found'}

IMPORTANT: Use the complaints email address (${contactInfo.complaintsEmail || contactInfo.email}) as the recipient for the email format letter. If an email was found, prioritize email format over postal format.`;
    }

    const systemPrompt = createLegallyRobustLetterPrompt(userLangCode, userLangName, isEnglish, finalLegalContext);

    const jsonCompletion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3, // Lower temperature for precise legal writing
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Conversation phase: LETTER; UserLang=${userLangCode} (${userLangName}); IsEnglish=${isEnglish}` },
        ...history,
      ],
      response_format: { type: 'json_object' as const },
    });

    // Parse JSON safely
    let intro = '';
    let footer = '';
    let letterText = '';
    let letterMD = '';
    let trText = '';
    let trMD = '';

    try {
      const raw = jsonCompletion.choices[0]?.message?.content || '{}';
      const data = JSON.parse(raw);
      intro = String(data.intro || '').trim();
      footer = String(data.footer || '').trim();
      letterText = String(data.letter_en_text || '').trim();
      letterMD = String(data.letter_en_markdown || '').trim();
      if (!isEnglish) {
        trText = String(data.letter_translation_text || '').trim();
        trMD = String(data.letter_translation_markdown || '').trim();
      }
    } catch (error) {
      console.error('Letter JSON parse error:', error);
      const msg = 'Sorry — I had trouble preparing the letter. Please try again.';
      return new Response(msg, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }

    // Stitch into tags your UI can parse
    const out: string[] = [];
    if (intro) out.push(intro);

    if (letterText) {
      out.push('');
      out.push('<<LETTER_EN>>');
      out.push(letterText);
      out.push('<</LETTER_EN>>');
    }
    if (letterMD) {
      out.push('');
      out.push('<<LETTER_EN_MD>>');
      out.push(letterMD);
      out.push('<</LETTER_EN_MD>>');
    }

    if (!isEnglish && trText) {
      out.push('');
      out.push(`<<LETTER_TRANSLATION lang="${userLangName}">>`);
      out.push(trText);
      out.push('<</LETTER_TRANSLATION>>');
    }
    if (!isEnglish && trMD) {
      out.push('');
      out.push(`<<LETTER_TRANSLATION_MD lang="${userLangName}">>`);
      out.push(trMD);
      out.push('<</LETTER_TRANSLATION_MD>>');
    }

    if (footer) {
      out.push('');
      out.push(footer);
    }

    const stitched = out.join('\n');

    // Stream the stitched text
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          if (shouldPrependBanner) {
            const translated = await translateOneTimeBanner(userLangName);
            controller.enqueue(encoder.encode(translated + '\n\n'));
          }
          controller.enqueue(encoder.encode(stitched));
        } catch (error) {
          console.error('Letter stream error:', error);
          controller.enqueue(encoder.encode('\n\n[Error generating letter]\n'));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });

  } catch (error) {
    console.error('Main API handler error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}