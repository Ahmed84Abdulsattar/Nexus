import { LoadingState } from './LoadingState';

export function PageLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl p-6 md:p-8">
      <LoadingState />
    </div>
  );
}
