import { Hero } from "../components/Hero/Hero";
import { LearningModes } from "../components/LearningModes/LearningModes";
import { TutorComposer } from "../components/TutorComposer/TutorComposer";
import { TutorResponse } from "../components/TutorResponse/TutorResponse";
import { ChapterExplorer } from "../components/ChapterExplorer/ChapterExplorer";
import { CoverageNote } from "../components/CoverageNote/CoverageNote";
import { useTutor } from "../hooks/useTutor";

const MAX_QUESTION_LENGTH = 1200;

export function Home() {
  const { turns, ask, retry, stop, newConversation, isStreaming, mode, setMode, subject, chapter, setFocus } =
    useTutor();

  return (
    <div className="notebook-page">
      <div className="container">
        <Hero />

        <CoverageNote />

        <ChapterExplorer selectedSubject={subject} selectedChapter={chapter} onSelect={setFocus} />

        <LearningModes value={mode} onChange={setMode} />

        <TutorComposer onSubmit={ask} onStop={stop} isStreaming={isStreaming} maxLength={MAX_QUESTION_LENGTH} />

        {turns.length === 0 ? (
          <p className="empty-state">
            Ask a question above, or pick a subject and chapter first if you want SchoolBook to search more
            precisely.
          </p>
        ) : (
          <>
            <section aria-live="polite">
              {turns.map((turn, i) => (
                <TutorResponse key={i} turn={turn} onRetry={() => retry(i)} />
              ))}
            </section>
            <button className="new-conversation-btn" onClick={newConversation} disabled={isStreaming}>
              Start a new conversation
            </button>
          </>
        )}
      </div>
    </div>
  );
}
