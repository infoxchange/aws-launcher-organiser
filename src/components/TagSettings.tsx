import { Button } from "primereact/button";
import { ColorPicker } from "primereact/colorpicker";
import { InputText } from "primereact/inputtext";
import type React from "react";
import { useRef, useState } from "react";
import type { TagConfig } from "../utils/configStore";
import "./TagSettings.css";

interface TagFormFieldsProps {
  tag: TagConfig;
  onTagChange: (tag: TagConfig) => void;
  onMatcherValidate: (matcher: string) => boolean;
  matcherError: string | null;
  idPrefix: string;
}

export const TagFormFields: React.FC<TagFormFieldsProps> = ({
  tag,
  onTagChange,
  onMatcherValidate,
  matcherError,
  idPrefix,
}) => (
  <div className="form-column">
    <div className="form-group">
      <label htmlFor={`${idPrefix}-key`}>Key</label>
      <InputText
        id={`${idPrefix}-key`}
        value={tag.key}
        onChange={(e) => onTagChange({ ...tag, key: e.target.value })}
        placeholder="e.g., prod"
      />
    </div>
    <div className="form-group">
      <label htmlFor={`${idPrefix}-name`}>Name</label>
      <InputText
        id={`${idPrefix}-name`}
        value={tag.name}
        onChange={(e) => onTagChange({ ...tag, name: e.target.value })}
        placeholder="e.g., Production"
      />
    </div>
    <div className="form-group">
      <label htmlFor={`${idPrefix}-colour`}>Colour</label>
      <div className="colour-input-group">
        <ColorPicker
          value={tag.colour.replace(/^#/, "")}
          onChange={(e) => onTagChange({ ...tag, colour: `#${e.value as string}` })}
          inline
        />
        <InputText
          value={tag.colour}
          onChange={(e) => onTagChange({ ...tag, colour: e.target.value })}
          placeholder="#000000"
          className="hex-input"
        />
      </div>
    </div>
    <div className="form-group">
      <label htmlFor={`${idPrefix}-matcher`}>Matcher (optional)</label>
      <InputText
        id={`${idPrefix}-matcher`}
        value={tag.matcher || ""}
        onChange={(e) => {
          const value = e.target.value || undefined;
          onTagChange({ ...tag, matcher: value });
          if (value) {
            onMatcherValidate(value);
          } else {
            // Clear error when matcher is cleared
            onMatcherValidate("");
          }
        }}
        placeholder="e.g., prod-.*"
        className={matcherError ? "p-invalid" : ""}
      />
      {matcherError && <small className="matcher-error">{matcherError}</small>}
    </div>
  </div>
);

export interface TagSettingsProps {
  tags: TagConfig[];
  onTagsChange: (tags: TagConfig[]) => void;
  editingTag: TagConfig;
  onEditingTagChange: (tag: TagConfig) => void;
  editingTagIndex: number | null;
  onEditingTagIndexChange: (index: number | null) => void;
  showAddTagForm: boolean;
  onShowAddTagFormChange: (show: boolean) => void;
  matcherError: string | null;
  onMatcherErrorChange: (error: string | null) => void;
  onValidateMatcher: (matcher: string) => boolean;
}

export const TagSettings: React.FC<TagSettingsProps> = ({
  tags,
  onTagsChange,
  editingTag,
  onEditingTagChange,
  editingTagIndex,
  onEditingTagIndexChange,
  showAddTagForm,
  onShowAddTagFormChange,
  matcherError,
  onMatcherErrorChange,
  onValidateMatcher,
}) => {
  const handleAddTag = () => {
    if (!editingTag.key || !editingTag.name) return;
    if (editingTag.matcher && !onValidateMatcher(editingTag.matcher)) return;
    const newTags = [...tags, editingTag];
    onTagsChange(newTags);
    onEditingTagChange({ key: "", name: "", colour: "#000000" });
    onMatcherErrorChange(null);
    onShowAddTagFormChange(false);
  };

  const handleSaveTag = (index: number) => {
    if (!editingTag.key || !editingTag.name) return;
    if (editingTag.matcher && !onValidateMatcher(editingTag.matcher)) return;
    const newTags = [...tags];
    newTags[index] = editingTag;
    onTagsChange(newTags);
    onEditingTagIndexChange(null);
    onEditingTagChange({ key: "", name: "", colour: "#000000" });
    onMatcherErrorChange(null);
  };

  const handleDeleteTag = (index: number) => {
    const newTags = tags.filter((_, i) => i !== index);
    onTagsChange(newTags);
    onEditingTagIndexChange(null);
  };

  const handleEditTag = (index: number) => {
    onEditingTagIndexChange(index);
    onEditingTagChange(tags[index]);
  };

  const handleCancel = () => {
    onEditingTagIndexChange(null);
    onEditingTagChange({ key: "", name: "", colour: "#000000" });
    onMatcherErrorChange(null);
  };

  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = (index: number) => {
    dragIndexRef.current = index;
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = (index: number) => {
    const from = dragIndexRef.current;
    if (from === null || from === index) {
      dragIndexRef.current = null;
      setDragOverIndex(null);
      return;
    }
    const reordered = [...tags];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(index, 0, moved);
    onTagsChange(reordered);
    dragIndexRef.current = null;
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    dragIndexRef.current = null;
    setDragOverIndex(null);
  };

  const handleAddCancel = () => {
    onShowAddTagFormChange(false);
    onEditingTagChange({ key: "", name: "", colour: "#000000" });
    onMatcherErrorChange(null);
  };

  return (
    <div className="tag-settings">
      <section className="tags-section">
        <h4 className="section-heading">Tags</h4>
        <ol className="tags-list">
          {tags.length === 0 ? (
            <li className="empty-message">No tags configured yet</li>
          ) : (
            tags.map((tag, index) => (
              <li
                key={tag.key}
                className={`tag-item${dragOverIndex === index ? " drag-over" : ""}`}
                onDragOver={(e) => handleDragOver(e, index)}
                onDrop={() => handleDrop(index)}
                onDragEnd={handleDragEnd}
              >
                {editingTagIndex === index ? (
                  <div className="tag-edit-form">
                    <TagFormFields
                      tag={editingTag}
                      onTagChange={onEditingTagChange}
                      onMatcherValidate={onValidateMatcher}
                      matcherError={matcherError}
                      idPrefix={`tag-${index}`}
                    />
                    <div className="tag-edit-buttons">
                      <Button
                        label="Save"
                        size="small"
                        onClick={() => handleSaveTag(index)}
                        disabled={matcherError !== null}
                      />
                      <Button label="Cancel" size="small" outlined onClick={handleCancel} />
                    </div>
                  </div>
                ) : (
                  <div className="tag-display">
                    <button
                      type="button"
                      className="drag-handle"
                      draggable
                      onDragStart={() => handleDragStart(index)}
                      title="Drag to reorder"
                    >
                      <i className="pi pi-bars" />
                    </button>
                    <div className="tag-preview">
                      <span className="tag-colour-dot" style={{ backgroundColor: tag.colour }} />
                      <div className="tag-info">
                        <div className="tag-name">{tag.name}</div>
                        <div className="tag-key">{tag.key}</div>
                        {tag.matcher && <div className="tag-matcher">{tag.matcher}</div>}
                      </div>
                    </div>
                    <div className="tag-actions">
                      <Button
                        icon="pi pi-pencil"
                        rounded
                        text
                        size="small"
                        onClick={() => handleEditTag(index)}
                      />
                      <Button
                        icon="pi pi-trash"
                        rounded
                        text
                        severity="danger"
                        size="small"
                        onClick={() => handleDeleteTag(index)}
                      />
                    </div>
                  </div>
                )}
              </li>
            ))
          )}
        </ol>

        {!showAddTagForm && (
          <Button
            label="Add Tag"
            icon="pi pi-plus"
            onClick={() => onShowAddTagFormChange(true)}
            className="add-tag-button"
          />
        )}

        {showAddTagForm && (
          <div className="add-tag-section">
            <h5>Add New Tag</h5>
            <TagFormFields
              tag={editingTag}
              onTagChange={onEditingTagChange}
              onMatcherValidate={onValidateMatcher}
              matcherError={matcherError}
              idPrefix="new-tag"
            />
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <Button
                label="Save New Tag"
                onClick={handleAddTag}
                disabled={!editingTag.key || !editingTag.name || matcherError !== null}
                icon="pi pi-plus"
              />
              <Button label="Cancel" outlined onClick={handleAddCancel} />
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
