import SwiftUI
import UniformTypeIdentifiers
import PhotosUI

struct DocumentsView: View {
    @ObservedObject var session: TripSession
    @EnvironmentObject private var auth: AuthViewModel

    @State private var documents: [TripDocument] = []
    @State private var expandedCategories: Set<String> = []
    @State private var showForm = false
    @State private var editingDocument: TripDocument?
    @State private var formTitle = ""
    @State private var formCategory = "General"
    @State private var formDescription = ""
    @State private var customCategory = ""
    @State private var isAddingCategory = false
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var importedFiles: [PendingDocumentFile] = []
    @State private var existingFiles: [DocumentFile] = []
    @State private var viewer: DocumentViewerState?
    @State private var sessionCategories: [String] = []
    @State private var isSaving = false
    @State private var showFileImporter = false

    private let builtInCategories = ["Hotel", "Transport", "Flight", "Ticket", "General"]

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            header
            if documents.isEmpty {
                EmptyState(
                    systemImage: "doc.text",
                    title: "No documents yet",
                    message: "Store tickets, confirmations, and PDFs for your trip."
                )
                .padding(.vertical, 16)
            } else {
                categoryGroups
            }
        }
        .padding(20)
        .onAppear { loadDocuments() }
        .onChange(of: session.activeItineraryId) { _, _ in loadDocuments() }
        .sheet(isPresented: $showForm) {
            documentFormSheet
        }
        .sheet(item: $viewer) { state in
            documentViewer(state)
        }
        .fileImporter(
            isPresented: $showFileImporter,
            allowedContentTypes: [.pdf, .image, .data, .content],
            allowsMultipleSelection: true
        ) { result in
            importFiles(from: result)
        }
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 8) {
                SectionHeader(eyebrow: "Paper trail", title: "Trip documents")
                Text("Tickets, bookings, and files in one place.")
                    .font(.subheadline)
                    .foregroundStyle(ShellChrome.inkMuted)
            }
            Spacer()
            CompactPillButton(title: "Add", systemImage: "plus", kind: .primary) {
                resetForm()
                showForm = true
            }
        }
    }

    private var allCategories: [String] {
        var set = Set(builtInCategories + sessionCategories)
        documents.forEach { set.insert($0.category) }
        return set.sorted()
    }

    private var groupedDocuments: [String: [TripDocument]] {
        Dictionary(grouping: documents, by: \.category)
    }

    private var categoryGroups: some View {
        VStack(spacing: 12) {
            ForEach(groupedDocuments.keys.sorted(), id: \.self) { category in
                categorySection(category: category, docs: groupedDocuments[category] ?? [])
            }
        }
    }

    private func categorySection(category: String, docs: [TripDocument]) -> some View {
        let isExpanded = expandedCategories.contains(category)
        return VStack(spacing: 0) {
            Button {
                toggleCategory(category)
            } label: {
                HStack {
                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                        .font(.caption.weight(.bold))
                    Image(systemName: "folder")
                        .foregroundStyle(ShellChrome.accent)
                    Text(category)
                        .font(.subheadline.weight(.semibold))
                    Spacer()
                    Text("\(docs.count)")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(ShellChrome.inkMuted)
                }
                .padding(14)
            }
            .buttonStyle(.plain)

            if isExpanded {
                VStack(spacing: 8) {
                    ForEach(docs) { doc in
                        documentRow(doc)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 14)
            }
        }
        .shellCard()
        .onAppear {
            if expandedCategories.isEmpty {
                expandedCategories = Set(groupedDocuments.keys)
            }
        }
    }

    private func documentRow(_ doc: TripDocument) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(doc.title)
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Button {
                    startEdit(doc)
                } label: {
                    Image(systemName: "pencil")
                }
                .buttonStyle(.plain)
                Button(role: .destructive) {
                    deleteDocument(doc)
                } label: {
                    Image(systemName: "trash")
                }
                .buttonStyle(.plain)
            }
            if !doc.description.isEmpty {
                Text(doc.description)
                    .font(.caption)
                    .foregroundStyle(ShellChrome.inkMuted)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Array(doc.files.enumerated()), id: \.element.path) { index, file in
                        Button {
                            viewer = DocumentViewerState(document: doc, fileIndex: index)
                        } label: {
                            fileChip(file)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(12)
        .background(ShellChrome.background)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func fileChip(_ file: DocumentFile) -> some View {
        HStack(spacing: 6) {
            Image(systemName: file.type.hasPrefix("image/") ? "photo" : "doc")
            Text(file.name)
                .lineLimit(1)
        }
        .font(.caption.weight(.semibold))
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(ShellChrome.accentSoft)
        .clipShape(Capsule())
    }

    private var documentFormSheet: some View {
        NavigationStack {
            Form {
                Section("Details") {
                    TextField("Title", text: $formTitle)
                    if isAddingCategory {
                        TextField("Custom category", text: $customCategory)
                        Button("Use preset categories") { isAddingCategory = false }
                    } else {
                        Picker("Category", selection: $formCategory) {
                            ForEach(allCategories, id: \.self) { cat in
                                Text(cat).tag(cat)
                            }
                        }
                        Button("Add custom category") {
                            isAddingCategory = true
                            customCategory = ""
                        }
                    }
                    TextField("Description", text: $formDescription, axis: .vertical)
                        .lineLimit(2...5)
                }
                Section("Files") {
                    if !existingFiles.isEmpty {
                        ForEach(existingFiles) { file in
                            Text(file.name)
                                .font(.caption)
                        }
                    }
                    PhotosPicker(selection: $pickerItems, matching: .images) {
                        Label("Photos & images", systemImage: "photo")
                    }
                    .onChange(of: pickerItems) { _, items in
                        Task { await ingestPickerItems(items) }
                    }
                    Button {
                        showFileImporter = true
                    } label: {
                        Label("Import files", systemImage: "folder")
                    }
                    ForEach(importedFiles) { pending in
                        Text(pending.name)
                            .font(.caption)
                    }
                }
            }
            .navigationTitle(editingDocument == nil ? "New document" : "Edit document")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showForm = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save") {
                        Task { await saveDocument() }
                    }
                    .disabled(formTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSaving)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder
    private func documentViewer(_ state: DocumentViewerState) -> some View {
        let file = state.document.files[state.fileIndex]
        NavigationStack {
            Group {
                if file.type.hasPrefix("image/"), let image = TripDocumentStore.loadUIImage(file: file) {
                    ScrollView {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFit()
                            .padding()
                    }
                } else {
                    VStack(spacing: 16) {
                        Image(systemName: "doc.richtext")
                            .font(.largeTitle)
                            .foregroundStyle(ShellChrome.accent)
                        Text(file.name)
                            .font(.headline)
                        ShareLink(item: TripDocumentStore.fileURL(for: file.path)) {
                            Label("Open / Share", systemImage: "square.and.arrow.up")
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(ShellChrome.accent)
                    }
                    .padding()
                }
            }
            .navigationTitle(state.document.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { viewer = nil }
                }
            }
        }
    }

    private func toggleCategory(_ category: String) {
        if expandedCategories.contains(category) {
            expandedCategories.remove(category)
        } else {
            expandedCategories.insert(category)
        }
    }

    private func loadDocuments() {
        guard let id = session.activeItineraryId else {
            documents = []
            return
        }
        documents = TripDocumentStore.load(itineraryId: id)
        Task { await syncFromCloudIfNeeded(itineraryId: id) }
    }

    private func persist() {
        guard let id = session.activeItineraryId else { return }
        TripDocumentStore.save(documents, itineraryId: id)
    }

    private func resetForm() {
        editingDocument = nil
        formTitle = ""
        formCategory = "General"
        formDescription = ""
        customCategory = ""
        isAddingCategory = false
        pickerItems = []
        importedFiles = []
        existingFiles = []
    }

    private func startEdit(_ doc: TripDocument) {
        editingDocument = doc
        formTitle = doc.title
        formCategory = doc.category
        formDescription = doc.description
        existingFiles = doc.files
        importedFiles = []
        pickerItems = []
        isAddingCategory = false
        showForm = true
    }

    private func importFiles(from result: Result<[URL], Error>) {
        guard case .success(let urls) = result else { return }
        for url in urls {
            guard url.startAccessingSecurityScopedResource() else { continue }
            defer { url.stopAccessingSecurityScopedResource() }
            guard let data = try? Data(contentsOf: url) else { continue }
            let type = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            importedFiles.append(PendingDocumentFile(name: url.lastPathComponent, data: data, type: type))
        }
    }

    private func ingestPickerItems(_ items: [PhotosPickerItem]) async {
        for item in items {
            if let data = try? await item.loadTransferable(type: Data.self) {
                let name = "photo-\(UUID().uuidString.prefix(6)).jpg"
                importedFiles.append(PendingDocumentFile(name: name, data: data, type: "image/jpeg"))
            }
        }
    }

    private func saveDocument() async {
        guard let itineraryId = session.activeItineraryId else { return }
        let title = formTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return }
        isSaving = true
        defer { isSaving = false }

        let category = resolvedCategory
        if isAddingCategory, !customCategory.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            sessionCategories.append(customCategory.trimmingCharacters(in: .whitespacesAndNewlines))
        }

        let now = ISO8601DateFormatter().string(from: Date())
        let docId = editingDocument?.id ?? UUID().uuidString
        var files = existingFiles

        for pending in importedFiles {
            if let saved = try? TripDocumentStore.writeFile(
                data: pending.data,
                itineraryId: itineraryId,
                documentId: docId,
                fileName: pending.name,
                mimeType: pending.type
            ) {
                files.append(saved)
            }
        }

        let document = TripDocument(
            id: docId,
            title: title,
            description: formDescription.trimmingCharacters(in: .whitespacesAndNewlines),
            category: category,
            files: files,
            createdAt: editingDocument?.createdAt ?? now,
            updatedAt: now
        )

        if let index = documents.firstIndex(where: { $0.id == docId }) {
            documents[index] = document
        } else {
            documents.insert(document, at: 0)
        }
        persist()
        showForm = false
        await upsertToCloud(document)
    }

    private var resolvedCategory: String {
        if isAddingCategory {
            let trimmed = customCategory.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? formCategory : trimmed
        }
        return formCategory
    }

    private func deleteDocument(_ doc: TripDocument) {
        for file in doc.files {
            TripDocumentStore.deleteFile(path: file.path)
        }
        documents.removeAll { $0.id == doc.id }
        persist()
        Task {
            await deleteFromCloud(doc.id)
        }
    }

    private var cloudEnabled: Bool {
        SupabaseClient.shared.isConfigured && !auth.skipsCloudGates
    }

    private func syncFromCloudIfNeeded(itineraryId: String) async {
        guard cloudEnabled else { return }
        do {
            let response = try await SupabaseClient.shared
                .from("trip_documents")
                .select("*")
                .execute()
            let rows = (try? JSONDecoder.supabase.decode([JSONAny].self, from: response.data)) ?? []
            let decoded = rows.compactMap { decodeTripDocumentRow($0) }
            if !decoded.isEmpty, documents.isEmpty {
                documents = decoded
                persist()
            }
        } catch {
            // Best-effort cloud fetch
        }
        _ = itineraryId
    }

    private func upsertToCloud(_ document: TripDocument) async {
        guard cloudEnabled else { return }
        let payload = documentCloudPayload(document)
        _ = try? await SupabaseClient.shared
            .from("trip_documents")
            .upsert(payload, onConflict: "id")
            .execute()
    }

    private func deleteFromCloud(_ id: String) async {
        guard cloudEnabled else { return }
        _ = try? await SupabaseClient.shared
            .from("trip_documents")
            .delete()
            .eq("id", value: id)
            .execute()
    }

    private func documentCloudPayload(_ document: TripDocument) -> [String: JSONAny] {
        struct StoragePayload: Codable {
            var category: String
            var files: [DocumentFile]
        }
        let storageJSON: String = {
            let payload = StoragePayload(category: document.category, files: document.files)
            guard let data = try? JSONEncoder().encode(payload),
                  let string = String(data: data, encoding: .utf8) else { return "{}" }
            return string
        }()
        let first = document.files.first
        return [
            "id": .string(document.id),
            "title": .string(document.title),
            "description": .string(document.description),
            "storage_path": .string(storageJSON),
            "file_name": .string(first?.name ?? ""),
            "mime_type": .string(first?.type ?? "application/octet-stream"),
            "updated_at": .string(document.updatedAt),
        ]
    }

    private func decodeTripDocumentRow(_ value: JSONAny) -> TripDocument? {
        guard case .object = value else { return nil }
        guard let data = try? JSONEncoder.supabase.encode(value) else { return nil }
        return try? JSONDecoder.supabase.decode(TripDocument.self, from: data)
    }
}

// MARK: - Storage

private struct PendingDocumentFile: Identifiable {
    let id = UUID()
    let name: String
    let data: Data
    let type: String
}

private struct DocumentViewerState: Identifiable {
    let id = UUID()
    let document: TripDocument
    let fileIndex: Int
}

private enum TripDocumentStore {
    static func storageKey(itineraryId: String) -> String { "documents-\(itineraryId)" }

    static func rootDirectory() -> URL {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let folder = documents.appendingPathComponent("TravelHandbookDocuments", isDirectory: true)
        if !FileManager.default.fileExists(atPath: folder.path) {
            try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        }
        return folder
    }

    static func load(itineraryId: String) -> [TripDocument] {
        LocalStore.getJSON([TripDocument].self, key: storageKey(itineraryId: itineraryId)) ?? []
    }

    static func save(_ documents: [TripDocument], itineraryId: String) {
        LocalStore.setJSON(documents, key: storageKey(itineraryId: itineraryId))
    }

    static func fileURL(for path: String) -> URL {
        rootDirectory().appendingPathComponent(path)
    }

    static func writeFile(
        data: Data,
        itineraryId: String,
        documentId: String,
        fileName: String,
        mimeType: String
    ) throws -> DocumentFile {
        let safeName = fileName.replacingOccurrences(of: "/", with: "-")
        let relative = "\(itineraryId)/\(documentId)/\(safeName)"
        let url = fileURL(for: relative)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
        return DocumentFile(path: relative, name: safeName, type: mimeType)
    }

    static func deleteFile(path: String) {
        let url = fileURL(for: path)
        try? FileManager.default.removeItem(at: url)
    }

    static func loadUIImage(file: DocumentFile) -> UIImage? {
        guard let data = try? Data(contentsOf: fileURL(for: file.path)) else { return nil }
        return UIImage(data: data)
    }
}
