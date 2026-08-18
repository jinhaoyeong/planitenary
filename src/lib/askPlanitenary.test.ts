import { describe, expect, it, vi } from 'vitest';
import { askPlanitenary, parseAskResult } from './askPlanitenary';

describe('Ask Planitenary network boundary', () => {
  it('keeps a valid read-only answer and only absolute web citations', () => {
    const result = parseAskResult({
      status: 'answered',
      answer: 'Rain is likely tomorrow, so keep the museum option.',
      citations: ['https://example.org/weather', 'javascript:alert(1)', '/relative'],
      proposal: { summary: 'Move the museum earlier', day: 2, placeNames: ['Museum'] },
      applied: false,
      transcript: [{ tool: 'get_weather', ok: true }],
      rejected: [],
    });

    expect(result.status).toBe('answered');
    expect(result.citations).toEqual(['https://example.org/weather']);
    expect(result.proposal?.summary).toBe('Move the museum earlier');
    expect(result.applied).toBe(false);
    expect(result.steps).toEqual([{ tool: 'get_weather', ok: true, detail: undefined }]);
  });

  it('refuses a payload that claims the proposal was applied', () => {
    const result = parseAskResult({
      status: 'answered',
      answer: 'I changed day two.',
      applied: true,
    });

    expect(result.status).toBe('refused');
    expect(result.answer).toBeUndefined();
    expect(result.applied).toBe(false);
    expect(result.detail).toMatch(/unexpected mutation state/i);
  });

  it('bounds questions before invoking the paid server path', async () => {
    const invoke = vi.fn();
    const result = await askPlanitenary({ tripId: 'trip-1', question: 'x'.repeat(601) }, invoke);
    expect(result.status).toBe('refused');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('sends only the operation, owned trip id and question', async () => {
    const invoke = vi.fn().mockResolvedValue({
      status: 'answered', answer: 'Answer', citations: [], applied: false, transcript: [], rejected: [],
    });
    await askPlanitenary({ tripId: 'trip-1', question: ' What should we do tonight? ' }, invoke);
    expect(invoke).toHaveBeenCalledWith('planitenary-agent', {
      operation: 'ask',
      tripId: 'trip-1',
      question: 'What should we do tonight?',
    });
  });

  it('forwards UI hints and conversation without treating them as trip facts', async () => {
    const invoke = vi.fn().mockResolvedValue({
      status: 'answered', answer: 'Answer', citations: [], applied: false, transcript: [], rejected: [],
    });
    await askPlanitenary({
      tripId: 'trip-1',
      question: 'What can I do after this?',
      uiContext: { tripId: 'trip-1', surface: 'itinerary', dayNumber: 2, selectedActivityId: 'act-1' },
      conversation: [{ question: 'Can I fit the castle?', answer: 'Yes, after lunch.' }],
    }, invoke);
    expect(invoke).toHaveBeenCalledWith('planitenary-agent', {
      operation: 'ask',
      tripId: 'trip-1',
      question: 'What can I do after this?',
      uiContext: { tripId: 'trip-1', surface: 'itinerary', dayNumber: 2, selectedActivityId: 'act-1' },
      conversation: [{ question: 'Can I fit the castle?', answer: 'Yes, after lunch.' }],
    });
  });

  it('degrades invocation failures to a renderable refusal', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('Daily limit reached.'));
    const result = await askPlanitenary({ tripId: 'trip-1', question: 'Help' }, invoke);
    expect(result).toMatchObject({ status: 'refused', applied: false, detail: 'Daily limit reached.' });
  });
});
