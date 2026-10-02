export type Priority = "low" | "medium" | "high";

export interface Todo {
  id: string;
  userId: string;
  title: string;
  description: string;
  dueDate: string | null;
  priority: Priority;
  completed: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface TodoWithTags extends Todo {
  tags: string[];
}

export type SortOption = "custom" | "priority" | "dueDate" | "createdAt";

export interface TodoFilter {
  status?: "active" | "completed" | "all";
  priority?: Priority;
  tag?: string;
  sortBy?: SortOption;
}
