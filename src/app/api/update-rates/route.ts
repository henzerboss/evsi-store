// src/app/api/update-rates/route.ts
// Этот файл нужно разместить в вашем проекте на Next.js (в папке src/app/api/update-rates/)

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function POST(req: NextRequest) {
    // 1. Защищаем эндпоинт секретным ключом, который передается в URL
    const secret = req.nextUrl.searchParams.get('secret');
    if (secret !== process.env.CRON_SECRET) {
        return NextResponse.json({ message: 'Invalid secret' }, { status: 401 });
    }

    try {
        // 2. Делаем запрос к ExchangeRate-API с вашим ключом из .env
        const apiKey = process.env.EXCHANGERATE_API_KEY;
        if (!apiKey) {
            throw new Error("EXCHANGERATE_API_KEY is not defined in .env.local");
        }
        
        const response = await fetch(`https://v6.exchangerate-api.com/v6/${apiKey}/latest/USD`);
        
        if (!response.ok) {
            throw new Error(`Failed to fetch rates: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.result !== 'success') {
            throw new Error('API response was not successful');
        }

        // 3. Готовим данные, которые будет использовать приложение
        const ratesToSave = {
            base_code: data.base_code,
            time_last_update_utc: data.time_last_update_utc,
            conversion_rates: data.conversion_rates,
        };

        // 4. ИЗМЕНЕНИЕ ЗДЕСЬ: Сохраняем данные в public/rates.json
        const filePath = path.join(process.cwd(), 'public', 'rates.json');
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, JSON.stringify(ratesToSave, null, 2));

        return NextResponse.json({ message: 'Rates updated successfully' }, { status: 200 });

    } catch (error) {
        console.error('Error updating rates:', error);
        return NextResponse.json({ message: 'Internal Server Error', error: (error as Error).message }, { status: 500 });
    }
}

