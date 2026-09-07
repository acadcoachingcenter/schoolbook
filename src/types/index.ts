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
  /** Client-generated opaque id (see src/lib/session.ts) used to persist/restore bounded history in D1. */
  sessionId?: string;
  /** Optional client-side history, used only as a fallback if sessionId/D1 lookup is unavailable. */
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

/** A subject/chapter combination that actually has indexed content — read
 * from the admin ingest registry, not a hand-maintained syllabus file, so it
 * always reflects the real current NCERT chapters rather than going stale
 * on syllabus revisions. */
export interface AvailableChapter {
  subjectId: string;
  chapterId: string;
  className: string;
  subjectName: string;
  chapterTitle: string;
  book: string;
  subtopics: string[];
}

export interface HealthResponse {
  status: "ok" | "degraded";
  service: string;
  rag: boolean;
}
