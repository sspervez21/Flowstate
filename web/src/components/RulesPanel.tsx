import { useState } from 'react';
import {
  useRules,
  useCreateRule,
  useUpdateRule,
  useToggleRule,
  useDeleteRule,
} from '../hooks/useRules';

const RULE_TYPES = [
  {
    type: 'keyword',
    label: 'Keyword boost',
    description: 'Boost messages containing a specific word or phrase',
    fields: [{ key: 'keyword', label: 'Keyword', placeholder: 'e.g. deployment' }],
  },
  {
    type: 'channel_boost',
    label: 'Channel boost',
    description: 'Always boost messages from a specific channel',
    fields: [{ key: 'channel_name', label: 'Channel name', placeholder: 'e.g. engineering' }],
  },
  {
    type: 'person_boost',
    label: 'Person boost',
    description: 'Boost messages from a specific person',
    fields: [{ key: 'person_name', label: 'Person name', placeholder: 'e.g. Alice' }],
  },
  {
    type: 'topic',
    label: 'Topic interest',
    description: 'Boost messages about a topic you care about',
    fields: [{ key: 'topic', label: 'Topic', placeholder: 'e.g. backend performance' }],
  },
];

const RULE_TYPE_LABELS: Record<string, string> = {
  keyword: 'Keyword',
  channel_boost: 'Channel',
  person_boost: 'Person',
  topic: 'Topic',
};

const RULE_TYPE_COLORS: Record<string, string> = {
  keyword: 'bg-blue-100 text-blue-700',
  channel_boost: 'bg-purple-100 text-purple-700',
  person_boost: 'bg-green-100 text-green-700',
  topic: 'bg-orange-100 text-orange-700',
};

export function RulesPanel() {
  const { data: rules, isLoading } = useRules();
  const createRule = useCreateRule();
  const updateRule = useUpdateRule();
  const toggleRule = useToggleRule();
  const deleteRule = useDeleteRule();

  const [showForm, setShowForm] = useState(false);
  const [selectedType, setSelectedType] = useState(RULE_TYPES[0].type);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  const handleCreate = () => {
    const typeDef = RULE_TYPES.find((t) => t.type === selectedType);
    if (!typeDef) return;

    const config: Record<string, unknown> = {};
    for (const field of typeDef.fields) {
      const val = fieldValues[field.key]?.trim();
      if (!val) return;
      config[field.key] = val;
    }

    createRule.mutate(
      { rule_type: selectedType, config },
      {
        onSuccess: () => {
          setShowForm(false);
          setFieldValues({});
        },
      },
    );
  };

  const startEditing = (ruleId: string, config: Record<string, unknown>) => {
    setEditingId(ruleId);
    const vals: Record<string, string> = {};
    for (const [k, v] of Object.entries(config)) {
      vals[k] = String(v);
    }
    setEditValues(vals);
  };

  const saveEdit = (ruleId: string) => {
    const config: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(editValues)) {
      if (!v.trim()) return;
      config[k] = v.trim();
    }
    updateRule.mutate(
      { rule_id: ruleId, config },
      { onSuccess: () => setEditingId(null) },
    );
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValues({});
  };

  const currentTypeDef = RULE_TYPES.find((t) => t.type === selectedType);
  const isAnyMutating = createRule.isPending || updateRule.isPending || toggleRule.isPending || deleteRule.isPending;

  return (
    <div className="max-w-2xl mx-auto">
      {/* Rescoring indicator */}
      {isAnyMutating && (
        <div className="px-5 py-2 bg-blue-50 text-blue-600 text-sm flex items-center gap-2 border-b border-blue-100">
          <span className="inline-block w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          Updating rules and re-scoring messages...
        </div>
      )}

      {/* Explanation */}
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="text-base font-bold text-gray-900 mb-1">
          Relevance Scoring Rules
        </h2>
        <p className="text-sm text-gray-500 leading-relaxed">
          Flowstate uses AI to score each Slack message for how relevant it is to you.
          The scoring considers: <strong>direct @mentions</strong> of you,{' '}
          <strong>channels you're most active in</strong>,{' '}
          <strong>channels that mention you</strong>, and{' '}
          <strong>topics similar to what you post about</strong>.
          You can add custom rules below to boost specific keywords, channels, people, or topics.
          Changes automatically trigger re-scoring.
        </p>
      </div>

      {/* Built-in signals */}
      <div className="px-5 py-3 border-b border-gray-100">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Built-in signals (always active)
        </h3>
        <div className="space-y-1.5 text-sm text-gray-600">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-400" />
            Direct @mentions of you
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-400" />
            Messages in channels you write to most
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-purple-400" />
            High-engagement messages (many reactions/replies)
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-400" />
            Content matching topics you discuss
          </div>
        </div>
      </div>

      {/* Custom rules */}
      <div className="px-5 py-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Custom rules
          </h3>
          <button
            onClick={() => setShowForm(!showForm)}
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            {showForm ? 'Cancel' : '+ Add rule'}
          </button>
        </div>

        {/* Add rule form */}
        {showForm && (
          <div className="border border-gray-200 rounded-lg p-4 mb-4 bg-gray-50">
            <div className="flex gap-2 mb-3">
              {RULE_TYPES.map((rt) => (
                <button
                  key={rt.type}
                  onClick={() => {
                    setSelectedType(rt.type);
                    setFieldValues({});
                  }}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    selectedType === rt.type
                      ? 'bg-gray-900 text-white'
                      : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  {rt.label}
                </button>
              ))}
            </div>
            {currentTypeDef && (
              <>
                <p className="text-xs text-gray-500 mb-2">{currentTypeDef.description}</p>
                {currentTypeDef.fields.map((field) => (
                  <input
                    key={field.key}
                    type="text"
                    placeholder={field.placeholder}
                    value={fieldValues[field.key] ?? ''}
                    onChange={(e) =>
                      setFieldValues((p) => ({ ...p, [field.key]: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                ))}
                <button
                  onClick={handleCreate}
                  disabled={createRule.isPending}
                  className="px-4 py-1.5 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {createRule.isPending ? 'Adding...' : 'Add rule'}
                </button>
              </>
            )}
          </div>
        )}

        {/* Existing rules */}
        {isLoading ? (
          <div className="text-sm text-gray-400 py-4">Loading rules...</div>
        ) : !rules || rules.length === 0 ? (
          <div className="text-sm text-gray-400 py-4 text-center">
            No custom rules yet. Add one above to boost specific messages.
          </div>
        ) : (
          <div className="space-y-2">
            {rules.map((rule) => {
              const isEditing = editingId === rule.id;
              const typeDef = RULE_TYPES.find((t) => t.type === rule.rule_type);
              const configStr = Object.values(rule.config).join(', ');

              return (
                <div
                  key={rule.id}
                  className={`rounded-lg border transition-colors ${
                    rule.enabled
                      ? 'border-gray-200 bg-white'
                      : 'border-gray-100 bg-gray-50 opacity-60'
                  }`}
                >
                  {isEditing ? (
                    /* Inline edit mode */
                    <div className="px-3 py-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-medium ${RULE_TYPE_COLORS[rule.rule_type] ?? 'bg-gray-100 text-gray-600'}`}
                        >
                          {RULE_TYPE_LABELS[rule.rule_type] ?? rule.rule_type}
                        </span>
                        <span className="text-xs text-gray-400">Editing</span>
                      </div>
                      {(typeDef?.fields ?? Object.keys(rule.config).map((k) => ({ key: k, label: k, placeholder: '' }))).map((field) => (
                        <input
                          key={field.key}
                          type="text"
                          placeholder={field.placeholder}
                          value={editValues[field.key] ?? ''}
                          onChange={(e) =>
                            setEditValues((p) => ({ ...p, [field.key]: e.target.value }))
                          }
                          className="w-full px-3 py-1.5 border border-gray-200 rounded-md text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      ))}
                      <div className="flex gap-2">
                        <button
                          onClick={() => saveEdit(rule.id)}
                          disabled={updateRule.isPending}
                          className="px-3 py-1 bg-green-600 text-white text-xs font-medium rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors"
                        >
                          {updateRule.isPending ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="px-3 py-1 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Display mode */
                    <div className="flex items-center gap-3 px-3 py-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${RULE_TYPE_COLORS[rule.rule_type] ?? 'bg-gray-100 text-gray-600'}`}
                      >
                        {RULE_TYPE_LABELS[rule.rule_type] ?? rule.rule_type}
                      </span>
                      <span className="text-sm text-gray-700 flex-1 truncate">
                        {configStr}
                      </span>
                      <button
                        onClick={() => startEditing(rule.id, rule.config)}
                        className="text-xs font-medium text-blue-600 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() =>
                          toggleRule.mutate({ rule_id: rule.id, enabled: !rule.enabled })
                        }
                        className={`text-xs font-medium px-2 py-1 rounded transition-colors ${
                          rule.enabled
                            ? 'text-yellow-600 hover:bg-yellow-50'
                            : 'text-green-600 hover:bg-green-50'
                        }`}
                      >
                        {rule.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        onClick={() => deleteRule.mutate(rule.id)}
                        className="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
