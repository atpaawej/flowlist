import { AppHeader } from "@/components/app-header";
import { TodoList } from "@/components/todo-list";
import { requireAuth } from "@/lib/auth-dal";

export default async function DashboardPage() {
  await requireAuth();
  return (
    <div className="mx-auto w-full max-w-[720px] px-5 py-10 sm:px-6 sm:py-14">
      <AppHeader />
      <div className="mt-8">
        <TodoList />
      </div>
    </div>
  );
}