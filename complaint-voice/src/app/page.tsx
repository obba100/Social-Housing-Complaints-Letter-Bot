import Chat from '@/components/Chat';

export default function Page() {
  return (
    <main className="min-h-[100dvh] bg-gradient-to-br from-gray-50 via-white to-sky-50/30">
      <div className="max-w-2xl mx-auto p-3 sm:p-6 pb-[max(env(safe-area-inset-bottom),1rem)]">
        <Chat />
      </div>
    </main>
  );
}
