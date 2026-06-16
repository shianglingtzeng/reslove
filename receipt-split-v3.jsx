import { useState, useRef } from "react";

const COLORS = ["#7C6FF7","#F97B6B","#4ECDC4","#FFD166","#A78BFA","#FB7185"];
const COLORBG = ["#EEF0FF","#FFF0EE","#EEFAF9","#FFFBEE","#F5F0FF","#FFF0F3"];

function toBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// Greedy minimize-transfers algorithm
// balances: { memberName: netAmount }
// positive = others owe you; negative = you owe others
function minimizeTransfers(balances) {
  const credits = [], debts = [];
  Object.entries(balances).forEach(([name, amt]) => {
    const r = Math.round(amt * 100) / 100;
    if (r > 0.01) credits.push({ name, amt: r });
    else if (r < -0.01) debts.push({ name, amt: -r });
  });
  credits.sort((a, b) => b.amt - a.amt);
  debts.sort((a, b) => b.amt - a.amt);
  const txns = [];
  let ci = 0, di = 0;
  while (ci < credits.length && di < debts.length) {
    const pay = Math.min(credits[ci].amt, debts[di].amt);
    txns.push({ from: debts[di].name, to: credits[ci].name, amt: Math.round(pay) });
    credits[ci].amt -= pay;
    debts[di].amt -= pay;
    if (credits[ci].amt < 0.01) ci++;
    if (debts[di].amt < 0.01) di++;
  }
  return txns;
}

let itemIdCounter = 1;
let receiptIdCounter = 1;

export default function App() {
  const [members, setMembers] = useState(["", "", ""]);
  const [membersSet, setMembersSet] = useState(false);

  // receipts: [{id, label, imgPreview, payerIdx, items:[{id,name,price,mode,assignees}]}]
  const [receipts, setReceipts] = useState([]);
  const [activeReceiptId, setActiveReceiptId] = useState(null);

  const [view, setView] = useState("members");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [imgPreview, setImgPreview] = useState(null);
  const [imgBase64, setImgBase64] = useState(null);
  const [draftLabel, setDraftLabel] = useState("");
  const fileRef = useRef();

  const activeMembers = members.map((m, i) => ({
    name: m.trim() || `成員${i + 1}`, idx: i
  }));

  function confirmMembers() { setMembersSet(true); setView("home"); }

  function startNewReceipt() {
    setImgPreview(null); setImgBase64(null); setDraftLabel(""); setError("");
    setView("upload");
  }
  function editReceipt(id) { setActiveReceiptId(id); setView("review"); }
  function deleteReceipt(id) { setReceipts(r => r.filter(rc => rc.id !== id)); }

  async function handleFile(file) {
    if (!file) return;
    setImgPreview(URL.createObjectURL(file));
    setImgBase64(await toBase64(file));
    setError("");
  }

  function createReceipt(items, label) {
    const rc = {
      id: receiptIdCounter++,
      label: draftLabel || label || "收據",
      imgPreview,
      payerIdx: 0, // default to first member
      items: items.map(it => ({
        id: itemIdCounter++, name: it.name, price: it.price,
        mode: "equal", assignees: activeMembers.map(m => m.idx)
      }))
    };
    setReceipts(r => [...r, rc]);
    setActiveReceiptId(rc.id);
    setView("review");
  }

  async function recognise() {
    if (!imgBase64) return;
    setLoading(true); setError("");
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6", max_tokens: 1000,
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imgBase64 } },
            { type: "text", text: `請從這張收據/帳單圖片中辨識所有消費項目。
回傳純 JSON（不要 markdown）：
{"items":[{"name":"品項名稱","price":金額數字},...],"label":"簡短場合名稱2-4字"}
- 價格只要數字；稅金/服務費獨立列出；看不到項目則 items 為空陣列` }
          ]}]
        })
      });
      const data = await res.json();
      const text = data.content?.find(b => b.type === "text")?.text || "";
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
      createReceipt(parsed.items || [], parsed.label);
    } catch { setError("辨識失敗，請重試或手動新增"); }
    finally { setLoading(false); }
  }

  function skipToManual() { createReceipt([], ""); }

  // ── Receipt/item updaters ──
  const activeReceipt = receipts.find(r => r.id === activeReceiptId);

  function patchReceipt(id, patch) {
    setReceipts(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r));
  }
  function updateItems(id, updater) {
    setReceipts(rs => rs.map(r => r.id === id ? { ...r, items: updater(r.items) } : r));
  }
  function updateItem(itemId, key, val) {
    updateItems(activeReceiptId, items =>
      items.map(it => it.id === itemId ? { ...it, [key]: val } : it)
    );
  }
  function toggleAssignee(itemId, memberIdx) {
    updateItems(activeReceiptId, items => items.map(it => {
      if (it.id !== itemId) return it;
      const has = it.assignees.includes(memberIdx);
      const next = has ? it.assignees.filter(a => a !== memberIdx) : [...it.assignees, memberIdx];
      return { ...it, assignees: next.length ? next : it.assignees };
    }));
  }
  function addItem() {
    updateItems(activeReceiptId, items => [
      ...items,
      { id: itemIdCounter++, name: "", price: 0, mode: "equal", assignees: activeMembers.map(m => m.idx) }
    ]);
  }
  function removeItem(itemId) {
    updateItems(activeReceiptId, items => items.filter(it => it.id !== itemId));
  }

  const receiptTotal = rc => rc.items.reduce((s, it) => s + (parseFloat(it.price) || 0), 0);
  const totalAcrossAll = receipts.reduce((s, rc) => s + receiptTotal(rc), 0);

  // ── Result: net balance per member ──
  // Net[m] = amount_paid_by_m - share_owed_by_m
  // positive → others owe you; negative → you owe others
  function calcBalances() {
    const paid = {}, owed = {};
    activeMembers.forEach(m => { paid[m.name] = 0; owed[m.name] = 0; });

    receipts.forEach(rc => {
      const payerName = activeMembers[rc.payerIdx]?.name || activeMembers[0].name;
      paid[payerName] = (paid[payerName] || 0) + receiptTotal(rc);

      rc.items.forEach(it => {
        const price = parseFloat(it.price) || 0;
        const who = it.mode === "equal"
          ? activeMembers.map(m => m.idx)
          : it.assignees;
        if (!who.length) return;
        const share = price / who.length;
        who.forEach(idx => {
          const name = activeMembers[idx]?.name;
          if (name) owed[name] = (owed[name] || 0) + share;
        });
      });
    });

    const balances = {};
    activeMembers.forEach(m => {
      balances[m.name] = (paid[m.name] || 0) - (owed[m.name] || 0);
    });
    return { balances, paid, owed };
  }

  // ── Styles ──
  const btn = (bg = "#7C6FF7", col = "#fff") => ({
    background: bg, color: col, border: "none", borderRadius: 12,
    fontWeight: 700, fontSize: 15, cursor: "pointer", padding: "13px 0"
  });
  const card = {
    background: "#fff", border: "1.5px solid #EBEBFF",
    borderRadius: 14, padding: "14px 16px", marginBottom: 12
  };

  // ── Payer selector component (used in review) ──
  function PayerSelector({ receipt }) {
    return (
      <div style={{ background: "#FFFBEE", border: "1.5px solid #FFE8A3", borderRadius: 12, padding: "12px 14px", marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: "#B45309", fontWeight: 600, marginBottom: 10 }}>💳 誰付了這張單？</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {activeMembers.map(m => {
            const sel = receipt.payerIdx === m.idx;
            return (
              <button key={m.idx} onClick={() => patchReceipt(receipt.id, { payerIdx: m.idx })}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 14px", borderRadius: 20, border: "1.5px solid",
                  borderColor: sel ? COLORS[m.idx % COLORS.length] : "#E0DFFE",
                  background: sel ? COLORBG[m.idx % COLORBG.length] : "#fff",
                  color: sel ? COLORS[m.idx % COLORS.length] : "#AAA",
                  fontWeight: 600, fontSize: 13, cursor: "pointer"
                }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: sel ? COLORS[m.idx % COLORS.length] : "#DDD", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 700 }}>
                  {m.name[0].toUpperCase()}
                </div>
                {m.name}
                {sel && <span style={{ fontSize: 11 }}>✓</span>}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#F7F6FF", fontFamily: "'Noto Sans TC',system-ui,sans-serif", paddingBottom: 48 }}>
      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1.5px solid #EBEBFF", padding: "14px 20px", display: "flex", alignItems: "center", gap: 10, position: "sticky", top: 0, zIndex: 10 }}>
        <span style={{ fontSize: 20 }}>🧾</span>
        <span style={{ fontWeight: 700, fontSize: 16, color: "#3A2F7A", letterSpacing: 1 }}>分帳小幫手</span>
        {membersSet && view !== "home" && view !== "result" && (
          <button onClick={() => setView("home")} style={{ marginLeft: "auto", background: "none", border: "none", color: "#AAA", cursor: "pointer", fontSize: 13 }}>← 回首頁</button>
        )}
        {membersSet && (view === "home") && receipts.length > 0 && (
          <button onClick={() => setView("result")} style={{ marginLeft: "auto", background: "#EEF0FF", color: "#7C6FF7", border: "none", borderRadius: 8, padding: "6px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>結算 →</button>
        )}
        {view === "result" && (
          <button onClick={() => setView("home")} style={{ marginLeft: "auto", background: "none", border: "none", color: "#AAA", cursor: "pointer", fontSize: 13 }}>← 返回</button>
        )}
      </div>

      <div style={{ maxWidth: 480, margin: "0 auto", padding: "20px 16px" }}>

        {/* ── MEMBERS ── */}
        {view === "members" && (
          <div>
            <h2 style={{ color: "#3A2F7A", fontWeight: 700, fontSize: 20, marginBottom: 4 }}>設定成員</h2>
            <p style={{ color: "#AAA", fontSize: 14, marginBottom: 20 }}>本次分帳的人，最多 6 位</p>
            {members.map((m, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: "50%", background: COLORS[i % COLORS.length], display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                  {m.trim() ? m.trim()[0].toUpperCase() : i + 1}
                </div>
                <input value={m} onChange={e => { const n = [...members]; n[i] = e.target.value; setMembers(n); }}
                  placeholder={`成員 ${i + 1}`}
                  style={{ flex: 1, border: "1.5px solid #E0DFFE", borderRadius: 10, padding: "10px 14px", fontSize: 15, outline: "none", background: "#fff" }} />
                {members.length > 2 && (
                  <button onClick={() => setMembers(members.filter((_, idx) => idx !== i))} style={{ background: "none", border: "none", color: "#CCC", cursor: "pointer", fontSize: 18 }}>×</button>
                )}
              </div>
            ))}
            {members.length < 6 && (
              <button onClick={() => setMembers([...members, ""])} style={{ width: "100%", padding: 10, border: "1.5px dashed #C0BEFF", borderRadius: 10, background: "none", color: "#7C6FF7", fontWeight: 600, cursor: "pointer", marginTop: 4, fontSize: 14 }}>+ 新增成員</button>
            )}
            <button onClick={confirmMembers} style={{ ...btn(), width: "100%", marginTop: 28 }}>開始分帳 →</button>
          </div>
        )}

        {/* ── HOME ── */}
        {view === "home" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div>
                <h2 style={{ color: "#3A2F7A", fontWeight: 700, fontSize: 20, marginBottom: 2 }}>收據清單</h2>
                <p style={{ color: "#AAA", fontSize: 13 }}>共 {receipts.length} 張 · 總計 ${Math.round(totalAcrossAll)}</p>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                {activeMembers.map(m => (
                  <div key={m.idx} title={m.name} style={{ width: 28, height: 28, borderRadius: "50%", background: COLORS[m.idx % COLORS.length], display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 11 }}>
                    {m.name[0].toUpperCase()}
                  </div>
                ))}
              </div>
            </div>

            {receipts.length === 0 ? (
              <div style={{ textAlign: "center", padding: "48px 20px", color: "#CCC" }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
                <div style={{ fontSize: 14 }}>還沒有收據，先新增一張吧</div>
              </div>
            ) : receipts.map(rc => (
              <div key={rc.id} style={{ ...card, display: "flex", gap: 12, alignItems: "center" }}>
                {rc.imgPreview
                  ? <img src={rc.imgPreview} alt="" style={{ width: 48, height: 48, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
                  : <div style={{ width: 48, height: 48, borderRadius: 8, background: "#F0EFFF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>🧾</div>
                }
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: "#333", fontSize: 15 }}>{rc.label}</div>
                  <div style={{ color: "#AAA", fontSize: 12, marginTop: 2 }}>
                    {rc.items.length} 項 · ${Math.round(receiptTotal(rc))}
                    <span style={{ marginLeft: 6 }}>· 付款：
                      <span style={{ color: COLORS[rc.payerIdx % COLORS.length], fontWeight: 600 }}>
                        {activeMembers[rc.payerIdx]?.name || activeMembers[0].name}
                      </span>
                    </span>
                  </div>
                </div>
                <button onClick={() => editReceipt(rc.id)} style={{ background: "#EEF0FF", color: "#7C6FF7", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>編輯</button>
                <button onClick={() => deleteReceipt(rc.id)} style={{ background: "none", border: "none", color: "#DDD", cursor: "pointer", fontSize: 18, padding: "2px 4px" }}>×</button>
              </div>
            ))}

            <button onClick={startNewReceipt} style={{ ...btn(), width: "100%", marginTop: 8 }}>+ 新增收據</button>
            {receipts.length > 0 && (
              <button onClick={() => setView("result")} style={{ ...btn("#F0EFFF", "#7C6FF7"), width: "100%", marginTop: 10 }}>查看結算結果 →</button>
            )}
          </div>
        )}

        {/* ── UPLOAD ── */}
        {view === "upload" && (
          <div>
            <h2 style={{ color: "#3A2F7A", fontWeight: 700, fontSize: 20, marginBottom: 4 }}>新增收據</h2>
            <p style={{ color: "#AAA", fontSize: 14, marginBottom: 20 }}>拍照或上傳，AI 自動辨識</p>
            <input value={draftLabel} onChange={e => setDraftLabel(e.target.value)} placeholder="收據名稱（例：晚餐、超市）"
              style={{ width: "100%", boxSizing: "border-box", border: "1.5px solid #E0DFFE", borderRadius: 10, padding: "10px 14px", fontSize: 15, outline: "none", marginBottom: 14 }} />
            <div onClick={() => fileRef.current.click()} style={{ border: "2px dashed #C0BEFF", borderRadius: 16, background: "#fff", minHeight: 180, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", overflow: "hidden", marginBottom: 12 }}>
              {imgPreview
                ? <img src={imgPreview} alt="receipt" style={{ maxWidth: "100%", maxHeight: 280, objectFit: "contain" }} />
                : <>
                  <span style={{ fontSize: 40, marginBottom: 10 }}>📷</span>
                  <span style={{ color: "#7C6FF7", fontWeight: 600 }}>點擊上傳收據照片</span>
                  <span style={{ color: "#AAA", fontSize: 13, marginTop: 4 }}>支援 JPG、PNG</span>
                </>
              }
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
            {imgPreview && <button onClick={() => { setImgPreview(null); setImgBase64(null); fileRef.current.value = ""; }} style={{ background: "none", border: "none", color: "#AAA", cursor: "pointer", fontSize: 13, marginBottom: 8 }}>重新選擇</button>}
            {error && <p style={{ color: "#F97B6B", fontSize: 13, marginBottom: 8 }}>{error}</p>}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setView("home")} style={{ ...btn("#F0EFFF", "#7C6FF7"), flex: 1 }}>← 返回</button>
              <button onClick={recognise} disabled={!imgBase64 || loading} style={{ ...btn(imgBase64 && !loading ? "#7C6FF7" : "#C0BEFF"), flex: 2 }}>
                {loading ? "辨識中…" : "AI 辨識 →"}
              </button>
            </div>
            <div style={{ textAlign: "center", marginTop: 12 }}>
              <button onClick={skipToManual} style={{ background: "none", border: "none", color: "#AAA", cursor: "pointer", fontSize: 13, textDecoration: "underline" }}>跳過，手動輸入</button>
            </div>
          </div>
        )}

        {/* ── REVIEW ── */}
        {view === "review" && activeReceipt && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <input value={activeReceipt.label} onChange={e => patchReceipt(activeReceipt.id, { label: e.target.value })}
                style={{ flex: 1, border: "none", borderBottom: "2px solid #E0DFFE", background: "none", padding: "4px 0", fontSize: 18, fontWeight: 700, color: "#3A2F7A", outline: "none" }} />
              <span style={{ color: "#AAA", fontSize: 14 }}>${Math.round(receiptTotal(activeReceipt))}</span>
            </div>

            {/* 付款人選擇 */}
            <PayerSelector receipt={activeReceipt} />

            {activeReceipt.items.map(it => (
              <div key={it.id} style={card}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                  <input value={it.name} onChange={e => updateItem(it.id, "name", e.target.value)} placeholder="項目名稱"
                    style={{ flex: 1, border: "1px solid #E0DFFE", borderRadius: 8, padding: "7px 10px", fontSize: 14, outline: "none" }} />
                  <span style={{ color: "#AAA", fontSize: 14 }}>$</span>
                  <input type="number" value={it.price} onChange={e => updateItem(it.id, "price", e.target.value)}
                    style={{ width: 76, border: "1px solid #E0DFFE", borderRadius: 8, padding: "7px 10px", fontSize: 14, outline: "none", textAlign: "right" }} />
                  <button onClick={() => removeItem(it.id)} style={{ background: "none", border: "none", color: "#DDD", cursor: "pointer", fontSize: 18 }}>×</button>
                </div>
                <div style={{ display: "flex", gap: 6, marginBottom: it.mode === "custom" ? 8 : 0 }}>
                  {[["equal", "平均分"], ["custom", "指定分"]].map(([mode, label]) => (
                    <button key={mode} onClick={() => updateItem(it.id, "mode", mode)} style={{ padding: "4px 12px", borderRadius: 20, border: "1.5px solid", borderColor: it.mode === mode ? "#7C6FF7" : "#E0DFFE", background: it.mode === mode ? "#EEF0FF" : "#fff", color: it.mode === mode ? "#7C6FF7" : "#AAA", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                      {label}
                    </button>
                  ))}
                </div>
                {it.mode === "custom" && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                    {activeMembers.map(m => {
                      const sel = it.assignees.includes(m.idx);
                      return (
                        <button key={m.idx} onClick={() => toggleAssignee(it.id, m.idx)} style={{ padding: "4px 12px", borderRadius: 20, border: "1.5px solid", borderColor: sel ? COLORS[m.idx % COLORS.length] : "#E0DFFE", background: sel ? COLORBG[m.idx % COLORBG.length] : "#fff", color: sel ? COLORS[m.idx % COLORS.length] : "#AAA", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                          {m.name}
                        </button>
                      );
                    })}
                  </div>
                )}
                {it.mode === "equal" && <p style={{ fontSize: 12, color: "#CCC", margin: "4px 0 0" }}>所有人平均分攤</p>}
              </div>
            ))}

            <button onClick={addItem} style={{ width: "100%", padding: 10, border: "1.5px dashed #C0BEFF", borderRadius: 10, background: "none", color: "#7C6FF7", fontWeight: 600, cursor: "pointer", fontSize: 14, marginBottom: 16 }}>+ 新增項目</button>

            <div style={{ background: "#EEF0FF", borderRadius: 12, padding: "12px 16px", display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
              <span style={{ color: "#7C6FF7", fontWeight: 600 }}>小計</span>
              <span style={{ color: "#3A2F7A", fontWeight: 700, fontSize: 18 }}>${Math.round(receiptTotal(activeReceipt))}</span>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setView("home")} style={{ ...btn("#F0EFFF", "#7C6FF7"), flex: 1 }}>← 返回</button>
              <button onClick={() => setView("home")} style={{ ...btn(), flex: 2 }}>儲存 ✓</button>
            </div>
          </div>
        )}

        {/* ── RESULT ── */}
        {view === "result" && (() => {
          const { balances, paid, owed } = calcBalances();
          const transfers = minimizeTransfers(balances);

          return (
            <div>
              <h2 style={{ color: "#3A2F7A", fontWeight: 700, fontSize: 20, marginBottom: 4 }}>結算結果</h2>
              <p style={{ color: "#AAA", fontSize: 13, marginBottom: 20 }}>共 {receipts.length} 張收據 · 總計 ${Math.round(totalAcrossAll)}</p>

              {/* Per-person summary */}
              <div style={{ ...card, marginBottom: 16 }}>
                <div style={{ fontWeight: 700, color: "#3A2F7A", fontSize: 14, marginBottom: 12 }}>各人帳務摘要</div>
                {activeMembers.map(m => {
                  const p = Math.round(paid[m.name] || 0);
                  const o = Math.round(owed[m.name] || 0);
                  const net = p - o;
                  return (
                    <div key={m.idx} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid #F5F5FF" }}>
                      <div style={{ width: 34, height: 34, borderRadius: "50%", background: COLORS[m.idx % COLORS.length], display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                        {m.name[0].toUpperCase()}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, color: "#333", fontSize: 14 }}>{m.name}</div>
                        <div style={{ fontSize: 11, color: "#AAA", marginTop: 2 }}>
                          付出 <span style={{ color: "#4ECDC4", fontWeight: 600 }}>${p}</span>
                          　應付 <span style={{ color: "#F97B6B", fontWeight: 600 }}>${o}</span>
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 11, color: "#AAA", marginBottom: 2 }}>{net >= 0 ? "待收" : "待付"}</div>
                        <div style={{ fontWeight: 700, fontSize: 17, color: net >= 0 ? "#4ECDC4" : "#F97B6B" }}>
                          {net >= 0 ? "+" : ""}{net}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Transfer suggestions */}
              <div style={{ background: "#FFF9EE", border: "1.5px solid #FFE8A3", borderRadius: 14, padding: "14px 16px", marginBottom: 20 }}>
                <div style={{ fontWeight: 700, color: "#B45309", fontSize: 14, marginBottom: 12 }}>💸 轉帳建議（最少 {transfers.length} 筆）</div>
                {transfers.length === 0
                  ? <p style={{ color: "#AAA", fontSize: 14, margin: 0 }}>✓ 帳已平，無需轉帳</p>
                  : transfers.map((t, i) => {
                    const fromIdx = activeMembers.find(m => m.name === t.from)?.idx ?? 0;
                    const toIdx = activeMembers.find(m => m.name === t.to)?.idx ?? 0;
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0", borderBottom: i < transfers.length - 1 ? "1px solid #FFE8A3" : "none" }}>
                        <div style={{ width: 28, height: 28, borderRadius: "50%", background: COLORS[fromIdx % COLORS.length], display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 11, flexShrink: 0 }}>
                          {t.from[0].toUpperCase()}
                        </div>
                        <span style={{ fontWeight: 600, color: "#333", fontSize: 14 }}>{t.from}</span>
                        <span style={{ color: "#CCC", fontSize: 18 }}>→</span>
                        <div style={{ width: 28, height: 28, borderRadius: "50%", background: COLORS[toIdx % COLORS.length], display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 11, flexShrink: 0 }}>
                          {t.to[0].toUpperCase()}
                        </div>
                        <span style={{ fontWeight: 600, color: "#333", fontSize: 14 }}>{t.to}</span>
                        <span style={{ marginLeft: "auto", fontWeight: 700, color: "#D97706", fontSize: 18 }}>${t.amt}</span>
                      </div>
                    );
                  })
                }
              </div>

              {/* Per-receipt breakdown */}
              <div style={{ fontWeight: 700, color: "#3A2F7A", fontSize: 14, marginBottom: 10 }}>各張收據明細</div>
              {receipts.map(rc => (
                <div key={rc.id} style={{ ...card, marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, color: "#333" }}>{rc.label}</span>
                    <span style={{ color: "#7C6FF7", fontWeight: 700 }}>${Math.round(receiptTotal(rc))}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#AAA", marginBottom: 8 }}>
                    付款人：<span style={{ color: COLORS[rc.payerIdx % COLORS.length], fontWeight: 600 }}>{activeMembers[rc.payerIdx]?.name}</span>
                  </div>
                  {rc.items.map(it => (
                    <div key={it.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
                      <span style={{ color: "#555" }}>{it.name || "（無名稱）"}</span>
                      <div style={{ textAlign: "right" }}>
                        <span style={{ color: "#888", marginRight: 8, fontSize: 12 }}>
                          {it.mode === "equal" ? "全員分" : activeMembers.filter(m => it.assignees.includes(m.idx)).map(m => m.name).join("、")}
                        </span>
                        <span style={{ color: "#333", fontWeight: 600 }}>${parseFloat(it.price).toFixed(0)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ))}

              <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                <button onClick={() => setView("home")} style={{ ...btn("#F0EFFF", "#7C6FF7"), flex: 1 }}>← 返回</button>
                <button onClick={() => { setReceipts([]); setView("home"); }} style={{ ...btn("#FFF0EE", "#F97B6B"), flex: 1 }}>清除重來</button>
              </div>
            </div>
          );
        })()}

      </div>
    </div>
  );
}
