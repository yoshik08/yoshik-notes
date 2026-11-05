import { Editor } from '@/components/editor/editor';

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Keyed so switching notes starts a fresh editor (sync, engine, history).
  return <Editor key={id} id={id} />;
}
