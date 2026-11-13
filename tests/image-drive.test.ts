import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { saveDriveImages, loadDriveImages, readDriveImages } from "@/features/pdf-editor/driveImages";
import { imageHash } from "@/features/pdf-editor/imageData";
import { saveNewDriveNote, loadDriveNoteDetails, type DriveNoteAccess } from "@/features/pdf-editor/googleDriveNotes";
import { readDriveManifest } from "@/features/pdf-editor/googleDriveNoteData";
import { driveManifestContent, sendDriveAutosave } from "@/features/pdf-editor/driveAutosaveRemote";
import { DriveHttpError } from "@/features/pdf-editor/driveHttpError";
import type { NoteBackup } from "@/features/pdf-editor/noteBackupData";
import type { DriveBinding } from "@/features/pdf-editor/driveOutbox";
import { imageFixture } from "./image-fixture";

type Stored = Record<string, unknown> & { id: string; appProperties: Record<string,string>; data?: Blob };
function fixture() {
  const files = new Map<string,Stored>(), uploads: string[] = [];
  let serial = 0;
  async function store(metadata: Record<string,unknown>,data?: Blob) {
    const id = String(metadata.id ?? `file_${++serial}`);
    const file = { ...files.get(id), ...metadata, id, ownedByMe: true, trashed: false, version: String(Number(files.get(id)?.version ?? 0)+1),
      modifiedTime: "2026-11-13T00:00:00Z", ...(data ? { data, size: String(data.size),sha256Checksum: await imageHash(data) } : {}) } as Stored;
    files.set(id,file);return file;
  }
  const access: DriveNoteAccess = {
    async json(path,params,body) {
      if (path === "files" && body) return store(body as Record<string,unknown>);
      if (path === "files") {
        const parent = params.q.match(/'([\w-]+)' in parents/)?.[1], hash = params.q.match(/key='overlayImageHash' and value='([a-f0-9]+)'/)?.[1];
        return {files: [...files.values()].filter(f => (f.parents as string[])?.includes(parent!) && f.appProperties.overlayImageHash===hash)};
      }
      const file = files.get(path.split("/")[1]);if (!file) throw new DriveHttpError(404,"missing");return file;
    },
    async upload(metadata,data) { uploads.push(String(metadata.mimeType));return store(metadata,data); },
    async download(id,max) {const data = files.get(id)?.data;if(!data) throw new Error("missing");assert.ok(data.size<=max);return data;},
    async replace(id,data,metadata={}) {return store({...metadata,id},data);},
  };
  return {files,uploads,access};
}
async function backup(): Promise<NoteBackup> {
  const doc = await PDFDocument.create();doc.addPage([200,200]);
  return {schemaVersion:5,kind:"note",name:"画像ノート",folders:[],notes:[{id:"local_A",title:"画像ノート",fileName:"source.pdf",folderId:null,
    pdf:new Blob([new Uint8Array(await doc.save())],{type:"application/pdf"}),strokesByPage:{},textsByPage:{},images:await imageFixture()}]};
}

test("Driveの元画像は初回だけ送信し、移動・ペン保存で再送せず、所有者と本文を検証する",async()=>{
  const f=fixture(),images=await imageFixture();
  const first=await saveDriveImages(f.access,"root_A","note_A","container_A",images);
  const moved={...images,byPage:{1:[{...images.byPage[1][0],x:.2}]}};
  const second=await saveDriveImages(f.access,"root_A","note_A","container_A",moved);
  assert.equal(f.uploads.length,1);assert.deepEqual(second?.assets,first?.assets);
  const loaded=await loadDriveImages(f.access,"root_A","note_A","container_A",second);
  assert.deepEqual(loaded?.byPage,moved.byPage);
  assert.deepEqual(await Object.values(loaded!.assets)[0].blob.arrayBuffer(),await Object.values(images.assets)[0].blob.arrayBuffer());
  const file=f.files.get(Object.values(first!.assets)[0].fileId)!;
  file.ownedByMe=false;await assert.rejects(loadDriveImages(f.access,"root_A","note_A","container_A",first),/所有者/);
  file.ownedByMe=true;file.data=new Blob([new Uint8Array(file.data!.size)],{type:"image/png"});
  await assert.rejects(loadDriveImages(f.access,"root_A","note_A","container_A",first));
  assert.throws(()=>readDriveImages({...first,assets:{}}),/不足/);
});

test("Driveの手動保存・読み込みに画像を含め、JSONへ画像本体を混ぜない",async()=>{
  const f=fixture(),input=await backup();
  const summary=await saveNewDriveNote(f.access,"root_A",input);
  const stored=f.files.get(summary.id)!;
  const manifest=readDriveManifest(JSON.parse(await stored.data!.text()),summary.noteKey);
  assert.equal(manifest.schemaVersion,5);assert.ok(manifest.images);
  assert.ok(!JSON.stringify(manifest).includes("base64"));
  const loaded=await loadDriveNoteDetails(f.access,"root_A",summary.id);
  assert.deepEqual(loaded.backup.notes[0].images?.byPage,input.notes[0].images?.byPage);
  assert.deepEqual(await Object.values(loaded.backup.notes[0].images!.assets)[0].blob.arrayBuffer(),await Object.values(input.notes[0].images!.assets)[0].blob.arrayBuffer());
  await assert.rejects(loadDriveNoteDetails(f.access,"root_B",summary.id),/所有者/);
});

test("画像の取得中にDriveの本文が更新された場合は古い内容を採用しない",async()=>{
  const f=fixture(),summary=await saveNewDriveNote(f.access,"root_A",await backup());
  const download=f.access.download.bind(f.access);
  f.access.download=async(id,max)=>{
    const result=await download(id,max);
    if(result.type==="image/png") {
      const note=f.files.get(summary.id)!;
      note.version=String(Number(note.version)+1);
    }
    return result;
  };
  await assert.rejects(loadDriveNoteDetails(f.access,"root_A",summary.id),/取得中にDriveノートが変わりました/);
});

test("Drive自動保存の画像をハッシュへ含め、2回目はPDFと画像をアップロードし直さない",async()=>{
  const f=fixture(),input=await backup();
  const binding: DriveBinding & {pdfHash:string}={id:"local_A",enabled:true,dirtySince:1,changedAt:1,key:"key_A",accountId:"account_A",rootId:"root_A",deviceId:"device_A",
    generation:1,uploadedGeneration:0,pdfHash:await imageHash(input.notes[0].pdf),ids:{container:"container_A",pdf:"pdf_A",note:"note_A"}};
  const first=await sendDriveAutosave(f.access,binding,input);
  assert.ok(first);
  const stored=f.files.get("note_A")!,manifest=readDriveManifest(JSON.parse(await stored.data!.text()),"key_A");
  assert.equal(manifest.schemaVersion,5);
  assert.equal(manifest.sync!.hash,await imageHash(new Blob([JSON.stringify(driveManifestContent(manifest))])));
  const count=f.uploads.filter(type=>type!=="application/json").length;
  await sendDriveAutosave(f.access,{...binding,generation:2,uploadedGeneration:1},input);
  assert.equal(f.uploads.filter(type=>type!=="application/json").length,count);
});
