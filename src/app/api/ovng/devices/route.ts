import { NextResponse } from 'next/server';

// Helper: remove null, undefined, empty strings, and empty objects
const clean = (obj: Record<string, any>): Record<string, any> => {
	return Object.fromEntries(
		Object.entries(obj).filter(([, v]) =>
			v !== undefined &&
			v !== null &&
			v !== '' &&
			!(typeof v === 'object' && Object.keys(v).length === 0)
		)
	);
};

// Convert device to slim format
const toSlim = (device: any) => {
	const base = {
		// Identity
		devicefamily: device.deviceFamily,
		model: device.modelName || device.type,
		name: device.name,
		friendlyname: device.friendlyName,

		// Networking
		ip: device.ipAddress,
		ipv6: device.ipAddressV6,
		mac: device.macAddress,
		vpnip: device.deviceVpnIP,

		// Status
		ovngstatus: device.deviceStatus,
		managementconnectivity: device.managementConnectivity,

		// Software
		softwareversion: device.currentSwVer,
		configchanges: device.changes,

		// IDs
		deviceid: device.id,
		attachedorganizationid: device.organization,
		attachedsiteid: device.site?.id
	};

	return clean(base);
};

export async function GET() {
	const token = process.env.OV_CIRRUS_API_TOKEN;

	if (!token) {
		console.error('❌ OV_CIRRUS_API_TOKEN not configured');
		return NextResponse.json(
			{
				success: false,
				message: 'OV_CIRRUS_API_TOKEN is not configured',
				devices: [],
				count: 0
			},
			{ status: 500 }
		);
	}

	console.log('✅ Token found, length:', token.length);

	const apiUrl = 'https://sqa-sca.manage.ovcirrus.com/api/ov/v1/organizations/66c779718c8174fe9fbc3556/sites/66e37d7640afc832784ca9f4/devices';

	try {
		console.log('📡 Calling API:', apiUrl);

		const response = await fetch(apiUrl, {
			method: 'GET',
			headers: {
				'Authorization': `Bearer ${token}`,
				'Content-Type': 'application/json',
				'Accept': 'application/json',
			},
		});

		console.log('📊 Response status:', response.status, response.statusText);
		console.log('📊 Response headers:', Object.fromEntries(response.headers.entries()));

		if (!response.ok) {
			const errorText = await response.text();
			console.error('❌ API Error Response:', errorText.substring(0, 500)); // Log first 500 chars

			return NextResponse.json(
				{
					success: false,
					message: 'Failed to fetch from OV Cirrus API',
					error: `${response.status} ${response.statusText}`,
					errorBody: errorText.substring(0, 200), // Include snippet in response
					devices: [],
					count: 0
				},
				{ status: response.status }
			);
		}

		// Get the content type
		const contentType = response.headers.get('content-type');
		console.log('📄 Content-Type:', contentType);

		// Check if response is actually JSON
		if (!contentType || !contentType.includes('application/json')) {
			const text = await response.text();
			console.error('❌ Response is not JSON. Content-Type:', contentType);
			console.error('❌ Response body:', text.substring(0, 500));

			return NextResponse.json(
				{
					success: false,
					message: 'API returned non-JSON response',
					error: `Expected JSON but got ${contentType}`,
					responsePreview: text.substring(0, 200),
					devices: [],
					count: 0
				},
				{ status: 500 }
			);
		}

		const result = await response.json();
		console.log('✅ JSON parsed successfully');

		// Handle both array and object responses
		let devices = [];
		if (Array.isArray(result)) {
			devices = result;
		} else if (result.data && Array.isArray(result.data)) {
			devices = result.data;
		} else {
			devices = [];
		}

		console.log('📦 Found', devices.length, 'devices');

		// 🔥 FILTER AND CLEAN THE DEVICES
		const slimDevices = devices.map(toSlim);

		console.log('✨ Filtered to', slimDevices.length, 'slim devices');

		return NextResponse.json({
			success: true,
			message: 'Devices retrieved successfully',
			devices: slimDevices,
			count: slimDevices.length,
			timestamp: new Date().toISOString()
		});

	} catch (error) {
		console.error('💥 Error in /api/ovng/devices:', error);

		return NextResponse.json(
			{
				success: false,
				message: 'Server error while fetching devices',
				error: error instanceof Error ? error.message : 'Unknown error',
				errorStack: error instanceof Error ? error.stack : undefined,
				devices: [],
				count: 0
			},
			{ status: 500 }
		);
	}
}