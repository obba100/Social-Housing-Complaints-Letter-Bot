// app-code/src/app/page.tsx
import { Chat } from '@/components/Chat';

export default function Home() {
  return (
    <main className="container mx-auto px-4">
      <div className="text-center py-6">
        <h1 className="text-3xl font-bold">Social Housing Complaints Assistant</h1>
        <p className="text-gray-600 mt-2">I can help you draft a formal complaint letter based on UK legislation and guidance.</p>
      </div>
      <Chat />
    </main>
  );
}