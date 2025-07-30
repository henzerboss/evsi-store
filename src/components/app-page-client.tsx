// file: src/components/app-page-client.tsx
'use client';

import Image from 'next/image';
import { Github } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Application } from "@prisma/client";
import { PrivacyDialogWrapper } from '@/components/privacy-dialog-wrapper';

const AppStoreIcon = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18.665 15.3344C18.435 16.2344 17.745 18.0344 16.395 18.0344C15.045 18.0344 14.715 17.2244 13.575 17.2244C12.435 17.2244 12.075 18.0344 10.785 18.0344C9.495 18.0344 8.715 16.2044 8.485 15.3044C7.295 11.2144 9.075 7.54438 10.985 7.54438C12.185 7.54438 13.065 8.27437 13.575 8.27437C14.085 8.27437 15.165 7.51438 16.515 7.51438C18.425 7.51438 20.025 11.2844 18.665 15.3344Z" fill="currentColor"></path><path d="M14.2344 6.11719C14.7444 5.54719 15.1144 4.67719 15.0244 3.80719C14.1544 3.89719 13.2844 4.41719 12.7744 4.98719C12.2944 5.52719 11.8344 6.42719 11.9344 7.29719C12.8344 7.23719 13.7244 6.68719 14.2344 6.11719Z" fill="currentColor"></path></svg>
const GooglePlayIcon = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4.68373 2.44316L15.116 12.0005L4.68373 21.5578C4.15373 21.8578 3.5 21.4478 3.5 20.8118V3.18916C3.5 2.55316 4.15373 2.14316 4.68373 2.44316Z" fill="#00A050"></path><path d="M18.818 14.939L15.115 12L18.818 9.06099C19.467 8.61499 19.467 7.74999 18.818 7.30399L17.56 6.40299C17.159 6.12899 16.63 6.27099 16.42 6.69699L4.68404 2.443C4.15404 2.143 3.5 2.553 3.5 3.189V20.811C3.5 21.447 4.15404 21.857 4.68404 21.557L16.42 17.304C16.63 17.73 17.159 17.872 17.56 17.598L18.818 16.697C19.467 16.251 19.467 15.386 18.818 14.939Z" fill="#FFBC00"></path><path d="M18.818 9.06099L17.56 6.40299C17.159 6.12899 16.63 6.27099 16.42 6.69699L4.68404 2.443C4.15404 2.143 3.5 2.553 3.5 3.189V3.18916L15.116 12.0005L18.818 9.06099Z" fill="#FF3D00"></path><path d="M18.818 14.939L15.115 12L3.5 20.811V20.8118L16.42 17.304C16.63 17.73 17.159 17.872 17.56 17.598L18.818 16.697C19.467 16.251 19.467 15.386 18.818 14.939Z" fill="#316CF0"></path></svg>

interface AppPageClientProps {
    app: Application;
    localizedData: {
        title: string;
        description: string;
    };
    isPrivacyInitiallyOpen: boolean;
}

export function AppPageClient({ app, localizedData, isPrivacyInitiallyOpen }: AppPageClientProps) {
    const { title, description } = localizedData;

    return (
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
            <div className="flex flex-col items-center gap-8 md:flex-row md:items-start">
                <Image src={app.iconUrl} alt={`${title} icon`} width={160} height={160} className="rounded-[44px] border shadow-md flex-shrink-0" />
                <div className="flex flex-col items-center text-center md:items-start md:text-left">
                    <h1 className="text-4xl font-bold tracking-tight">{title}</h1>
                    <div className="mt-6 flex flex-wrap justify-center gap-3 md:justify-start">
                        {app.appStoreUrl && <Button asChild><a href={app.appStoreUrl} target="_blank" rel="noopener noreferrer"><AppStoreIcon /> App Store</a></Button>}
                        {app.googlePlayUrl && <Button asChild><a href={app.googlePlayUrl} target="_blank" rel="noopener noreferrer"><GooglePlayIcon /> Google Play</a></Button>}
                        {app.githubUrl && <Button asChild variant="secondary"><a href={app.githubUrl} target="_blank" rel="noopener noreferrer"><Github /> GitHub</a></Button>}
                        
                        <PrivacyDialogWrapper 
                          slug={app.slug}
                          title={title}
                          policyText={app.privacyPolicy_en || ''}
                          initiallyOpen={isPrivacyInitiallyOpen}
                        />
                    </div>
                </div>
            </div>
            <div className="mt-12 prose dark:prose-invert max-w-none">
                <p style={{ whiteSpace: 'pre-wrap' }}>{description}</p>
            </div>
        </div>
    );
}