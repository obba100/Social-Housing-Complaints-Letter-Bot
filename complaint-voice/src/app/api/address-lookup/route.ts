// src/app/api/address-lookup/route.ts
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { postcode } = await req.json();
    
    console.log('🔍 GetAddress.io lookup for:', postcode);
    
    if (!postcode || typeof postcode !== 'string') {
      return NextResponse.json({ error: 'Postcode required' }, { status: 400 });
    }

    // Clean postcode (remove spaces, uppercase)
    const cleanPostcode = postcode.replace(/\s/g, '').toUpperCase();
    
    // Validate UK postcode format
    const postcodeRegex = /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/;
    if (!postcodeRegex.test(cleanPostcode)) {
      return NextResponse.json({ error: 'Invalid UK postcode format' }, { status: 400 });
    }

    // Get GetAddress.io API key from environment
    const getAddressApiKey = process.env.GETADDRESS_API_KEY;
    if (!getAddressApiKey) {
      console.error('❌ GETADDRESS_API_KEY not found in environment variables');
      return NextResponse.json({ error: 'Address lookup service unavailable' }, { status: 503 });
    }

    console.log('✅ GetAddress API Key found, making request...');

    // GetAddress.io API call with expand=true for more detailed data
    const getAddressUrl = `https://api.getAddress.io/find/${cleanPostcode}?api-key=${getAddressApiKey}&expand=true`;
    
    const response = await fetch(getAddressUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'ComplaintLetterBot/1.0'
      }
    });

    console.log('📡 GetAddress API Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ GetAddress API error:', response.status, errorText);
      
      // Handle specific error codes
      if (response.status === 404) {
        return NextResponse.json({ error: 'Postcode not found' }, { status: 404 });
      }
      if (response.status === 401) {
        return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
      }
      if (response.status === 429) {
        return NextResponse.json({ error: 'API quota exceeded - upgrade your GetAddress.io plan' }, { status: 429 });
      }
      if (response.status === 400) {
        return NextResponse.json({ error: 'Invalid postcode format' }, { status: 400 });
      }
      
      return NextResponse.json({ 
        error: 'Address lookup failed', 
        details: `GetAddress.io API returned ${response.status}`
      }, { status: 500 });
    }

    const data = await response.json();
    console.log('✅ GetAddress API Response received');
    console.log('📊 Raw response:', JSON.stringify(data, null, 2));

    // Transform GetAddress.io data to our format
    if (!data.addresses || !Array.isArray(data.addresses)) {
      console.warn('⚠️ No addresses array in response');
      return NextResponse.json({ 
        error: 'No addresses found',
        message: 'GetAddress.io returned no addresses for this postcode'
      }, { status: 404 });
    }

    const addresses = data.addresses.map((address: string, index: number) => {
      console.log(`🏠 Processing address ${index}: "${address}"`);
      
      // GetAddress.io returns addresses as comma-separated strings
      // Example: "Flat 1, 123 High Street, Some Area, Town"
      const parts = address.split(', ').filter(part => part.trim() !== '');
      
      // Extract components intelligently
      let line1 = '';
      let line2 = '';
      let town = '';
      
      if (parts.length >= 1) {
        line1 = parts[0]; // First part is usually house number/name + street
      }
      
      if (parts.length >= 2) {
        // If the first part looks like just a house number/flat, combine with second part
        if (parts[0].match(/^(Flat|Apartment|Unit|\d+[a-zA-Z]?|[A-Z]\d+)$/i)) {
          line1 = `${parts[0]}, ${parts[1]}`;
          if (parts.length >= 3) {
            line2 = parts[2];
          }
        } else {
          line2 = parts[1];
        }
      }
      
      // Town is typically the last or second-to-last part
      if (parts.length >= 2) {
        town = parts[parts.length - 1];
      }
      
      return {
        id: `getaddress-${index}`,
        formatted: address,
        line1: line1,
        line2: line2,
        postcode: cleanPostcode,
        town: town,
        county: data.county || data.administrative_area || ''
      };
    });

    console.log(`✅ Transformed ${addresses.length} addresses`);

    // Sort addresses numerically by house number, then alphabetically
    addresses.sort((a: any, b: any) => {
      // Extract house numbers for proper numerical sorting
      const aMatch = a.line1.match(/^(\d+[a-zA-Z]?)/);
      const bMatch = b.line1.match(/^(\d+[a-zA-Z]?)/);
      
      if (aMatch && bMatch) {
        const aNum = parseInt(aMatch[1]);
        const bNum = parseInt(bMatch[1]);
        
        if (aNum !== bNum) {
          return aNum - bNum;
        }
        
        // If numbers are the same, sort by letter suffix (1A, 1B, etc.)
        return aMatch[1].localeCompare(bMatch[1]);
      }
      
      // If no numbers found, sort alphabetically
      return a.formatted.localeCompare(b.formatted);
    });

    return NextResponse.json({
      postcode: cleanPostcode,
      addresses: addresses,
      totalResults: addresses.length,
      source: 'GetAddress.io',
      county: data.county || data.administrative_area || '',
      country: data.country || 'England'
    });
    
  } catch (error) {
    console.error('❌ Address lookup error:', error);
    return NextResponse.json({ 
      error: 'Lookup failed', 
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}