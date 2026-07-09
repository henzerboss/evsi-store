import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';

function renderTermsText(termsText: string) {
  if (!termsText.trim()) {
    return <p>No terms provided.</p>;
  }

  return termsText
    .split(/\n{2,}/)
    .map((block, index) => {
      const text = block.trim();

      if (!text) return null;

      if (text.startsWith('### ')) {
        return <h3 key={index}>{text.slice(4)}</h3>;
      }

      if (text.startsWith('## ')) {
        return <h2 key={index}>{text.slice(3)}</h2>;
      }

      if (text.startsWith('# ')) {
        return <h1 key={index}>{text.slice(2)}</h1>;
      }

      if (/^last updated:/i.test(text)) {
        return <p key={index} className="text-sm text-muted-foreground">{text}</p>;
      }

      return (
        <p key={index} style={{ whiteSpace: 'pre-wrap' }}>
          {text}
        </p>
      );
    });
}

export function ApplicationTermsPage({
  slug,
  title,
  termsText,
}: {
  slug: string;
  title: string;
  termsText: string;
}) {
  return (
    <div className="container max-w-3xl mx-auto py-12 md:py-20 px-4 sm:px-6 lg:px-8">
      <div className="mb-8">
        <Button asChild variant="secondary" size="sm">
          <Link href={`/app/${slug}`}>← Back to app</Link>
        </Button>
      </div>

      <div className="prose dark:prose-invert max-w-none">
        {!termsText.trim().startsWith('# ') && <h1>Terms of Use for {title}</h1>}
        {renderTermsText(termsText)}
      </div>
    </div>
  );
}
