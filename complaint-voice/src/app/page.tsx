import Chat from '@/components/Chat';

export default function Page() {
  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto py-6">
        <h1 className="text-2xl font-semibold mb-2">Voice Complaint Helper</h1>
        <p className="text-sm text-gray-600 mb-4">
          Dictate or type your issue. We’ll draft your letter in plain English.
        </p>
        <Chat />
      </div>
    </main>
  );
}