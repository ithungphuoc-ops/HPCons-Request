export default function SimplePagePlaceholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="px-8 py-6">
      <h1 className="text-[23px] font-bold text-gray-900">{title}</h1>
      <div className="mt-6 flex min-h-[240px] items-center justify-center rounded-[3px] border border-dashed border-[var(--color-border)] bg-white text-center">
        <p className="max-w-md px-6 text-[14px] text-gray-400">{description}</p>
      </div>
    </div>
  );
}
