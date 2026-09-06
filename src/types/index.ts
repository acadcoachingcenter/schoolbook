export type LearningMode =
  | "explain"
  | "exam"
  | "deep-dive"
  | "quick-revision"
  | "quiz-me"
  | "socratic";

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AskRequest {
  question: string;
  mode?: LearningMode;
  subject?: string;
  chapter?: string;
  conversation?: ConversationMessage[];
}

export interface RetrievedSource {
  id: string;
  subject?: string;
  chapter?: string;
  page?: string;
  book?: string;
  snippet: string;
  score?: number;
}

export interface TutorResponse {
  answer: string;
  sources: RetrievedSource[];
  mode?: LearningMode;
  insufficientContext?: boolean;
}

export interface Subject {
  id: string;
  name: string;
  className: string;
  chapters: Chapter[];
}

export interface Chapter {
  id: string;
  name: string;
  book?: string;
}

export interface HealthResponse {
  status: "ok" | "degraded";
  service: string;
  rag: boolean;
}
