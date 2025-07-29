// file: src/components/application-card.tsx
import Image from 'next/image';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { getTranslations } from 'next-intl/server';

const AppStoreIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18.665 15.3344C18.435 16.2344 17.745 18.0344 16.395 18.0344C15.045 18.0344 14.715 17.2244 13.575 17.2244C12.435 17.2244 12.075 18.0344 10.785 18.0344C9.495 18.0344 8.715 16.2044 8.485 15.3044C7.295 11.2144 9.075 7.54438 10.985 7.54438C12.185 7.54438 13.065 8.27437 13.575 8.27437C14.085 8.27437 15.165 7.51438 16.515 7.51438C18.425 7.51438 20.025 11.2844 18.665 15.3344Z" fill="currentColor"></path><path d="M14.2344 6.11719C14.7444 5.54719 15.1144 4.67719 15.0244 3.80719C14.1544 3.89719 13.2844 4.41719 12.7744 4.98719C12.2944 5.52719 11.8344 6.42719 11.9344 7.29719C12.8344 7.23719 13.7244 6.68719 14.2344 6.11719Z" fill="currentColor"></path></svg>
const GooglePlayIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4.68373 2.44316L15.116 12.0005L4.68373 21.5578C4.15373 21.8578 3.5 21.4478 3.5 20.8118V3.18916C3.5 2.55316 4.15373 2.14316 4.68373 2.44316Z" fill="#00A050"></path><path d="M18.818 14.939L15.115 12L18.818 9.06099C19.467 8.61499 19.467 7.74999 18.818 7.30399L17.56 6.40299C17.159 6.12899 16.63 6.27099 16.42 6.69699L4.68404 2.443C4.15404 2.143 3.5 2.553 3.5 3.189V20.811C3.5 21.447 4.15404 21.857 4.68404 21.557L16.42 17.304C16.63 17.73 17.159 17.872 17.56 17.598L18.818 16.697C19.467 16.251 19.467 15.386 18.818 14.939Z" fill="#FFBC00"></path><path d="M18.818 9.06099L17.56 6.40299C17.159 6.12899 16.63 6.27099 16.42 6.69699L4.68404 2.443C4.15404 2.143 3.5 2.553 3.5 3.189V3.18916L15.116 12.0005L18.818 9.06099Z" fill="#FF3D00"></path><path d="M18.818 14.939L15.115 12L3.5 20.811V20.8118L16.42 17.304C16.63 17.73 17.159 17.872 17.56 17.598L18.818 16.697C19.467 16.251 19.467 15.386 18.818 14.939Z" fill="#316CF0"></path></svg>

interface ApplicationCardProps {
  slug: string;
  iconUrl: string;
  title: string;
  shortDescription: string;
  appStoreUrl: string | null;
  googlePlayUrl: string | null;
}

export async function ApplicationCard({ slug, iconUrl, title, shortDescription, appStoreUrl, googlePlayUrl }: ApplicationCardProps) {
  const t = await getTranslations("Navigation");

  return (
    <div className="group grid grid-cols-3 items-start gap-4">
      <Link href={`/app/${slug}`} className="col-span-1">
        <Image
          src={iconUrl}
          alt={`${title} icon`}
          width={80}
          height={80}
          className="w-full h-auto rounded-[22px]"
        />
      </Link>
      <div className="col-span-2 flex flex-col h-full">
        <Link href={`/app/${slug}`}>
          <h3 className="text-lg font-semibold tracking-tight group-hover:underline">{title}</h3>
        </Link>
        <p className="mt-1 text-sm text-muted-foreground line-clamp-2 flex-grow">
          {shortDescription}
        </p>
        <div className="mt-3 flex items-center gap-2">
          {appStoreUrl && <Button asChild size="sm" variant="outline"><a href={appStoreUrl} target="_blank" rel="noopener noreferrer"><AppStoreIcon /></a></Button>}
          {googlePlayUrl && <Button asChild size="sm" variant="outline"><a href={googlePlayUrl} target="_blank" rel="noopener noreferrer"><GooglePlayIcon /></a></Button>}
          <Button asChild size="sm" variant="ghost" className="text-muted-foreground">
            <Link href={`/app/${slug}`}>{t('read_more')}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}