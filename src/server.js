require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const { PrismaClient } = require("@prisma/client");

const app = express();
const prisma = new PrismaClient();
const port = Number(process.env.PORT || 3000);
const production = process.env.NODE_ENV === "production";

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  if (production) throw new Error("JWT_SECRET must be set to a random value of at least 32 characters.");
  console.warn("WARNING: Set a random JWT_SECRET in .env before using authentication.");
}
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: (process.env.CORS_ORIGIN || "http://localhost:8080").split(",").map(s => s.trim()), credentials: false }));
app.use(express.json({ limit: "100kb" }));
app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, limit: 180, standardHeaders: "draft-7", legacyHeaders: false }));
app.get("/api/health", (_req, res) => res.json({ ok: true, service: "hamikar-api", mode: production ? "production" : "development" }));

function normalizePhone(value) {
  return String(value || "")
    .replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[\s\-()]/g, "");
}
function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item));
}
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  phone: z.string().trim().regex(/^\+?[0-9۰-۹٠-٩\- ]{8,20}$/),
  password: z.string().min(10).max(100)
});
const loginSchema = z.object({ phone: z.string().trim().min(8).max(20), password: z.string().min(1).max(100) });

function tokenFor(user) {
  return jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "8h", issuer: "hamikar-api", audience: "hamikar-web" });
}
const auth = asyncRoute(async (req, res, next) => {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return res.status(401).json({ error: "ورود لازم است." });
  try {
    const claims = jwt.verify(header.slice(7), process.env.JWT_SECRET, { issuer: "hamikar-api", audience: "hamikar-web" });
    const user = await prisma.user.findUnique({ where: { id: claims.sub }, select: { id: true, fullName: true, phone: true, role: true, active: true } });
    if (!user || !user.active) return res.status(401).json({ error: "حساب کاربری فعال نیست." });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "نشست نامعتبر یا منقضی شده است." });
  }
});
const roles = (...allowed) => (req, res, next) => allowed.includes(req.user.role) ? next() : res.status(403).json({ error: "دسترسی مجاز نیست." });

app.post("/api/auth/register", rateLimit({ windowMs: 60 * 60 * 1000, limit: 8 }), asyncRoute(async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "اطلاعات ورودی معتبر نیست." });
  const phone = normalizePhone(parsed.data.phone);
  const exists = await prisma.user.findUnique({ where: { phone } });
  if (exists) return res.status(409).json({ error: "برای این شماره حساب وجود دارد." });
  const user = await prisma.user.create({ data: { fullName: parsed.data.fullName, phone, passwordHash: await bcrypt.hash(parsed.data.password, 12), role: "CUSTOMER" }, select: { id: true, fullName: true, phone: true, role: true } });
  await prisma.auditEvent.create({ data: { actorId: user.id, action: "account.registered" } });
  res.status(201).json({ user, token: tokenFor(user) });
}));

app.post("/api/auth/login", rateLimit({ windowMs: 15 * 60 * 1000, limit: 8 }), asyncRoute(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "اطلاعات ورود معتبر نیست." });
  const phone = normalizePhone(parsed.data.phone);
  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user || !user.active || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) return res.status(401).json({ error: "شماره تماس یا رمز عبور صحیح نیست." });
  await prisma.auditEvent.create({ data: { actorId: user.id, action: "account.login", ipAddress: req.ip } });
  res.json({ user: { id: user.id, fullName: user.fullName, phone: user.phone, role: user.role }, token: tokenFor(user) });
}));

app.get("/api/services", asyncRoute(async (_req, res) => {
  const services = await prisma.service.findMany({ where: { active: true }, orderBy: { title: "asc" }, select: { id: true, slug: true, title: true, description: true, audience: true, pricingType: true, priceRial: true, durationMinutes: true } });
  res.json({ services: jsonSafe(services) });
}));

app.get("/api/orders", auth, asyncRoute(async (req, res) => {
  const where = req.user.role === "ADMIN" ? {} : req.user.role === "EXPERT" ? { expertId: req.user.id } : { customerId: req.user.id };
  const orders = await prisma.order.findMany({ where, orderBy: { createdAt: "desc" }, include: { service: { select: { title: true, slug: true } }, files: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true } } } });
  res.json({ orders: jsonSafe(orders) });
}));

app.post("/api/orders", auth, roles("CUSTOMER"), asyncRoute(async (req, res) => {
  const schema = z.object({ serviceId: z.string().min(1), details: z.string().trim().min(10).max(10000), acceptedTerms: z.literal(true) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "شرح درخواست و پذیرش شرایط الزامی است." });
  const service = await prisma.service.findFirst({ where: { id: parsed.data.serviceId, active: true } });
  if (!service) return res.status(404).json({ error: "خدمت پیدا نشد." });
  const order = await prisma.order.create({ data: { customerId: req.user.id, serviceId: service.id, details: parsed.data.details, agreedTermsAt: new Date(), status: "REQUESTED" }, include: { service: { select: { title: true } } } });
  await prisma.auditEvent.create({ data: { actorId: req.user.id, orderId: order.id, action: "order.created" } });
  res.status(201).json({ order });
}));

app.patch("/api/orders/:id/status", auth, roles("ADMIN", "EXPERT"), asyncRoute(async (req, res) => {
  const schema = z.object({ status: z.enum(["REQUESTED", "UNDER_REVIEW", "QUOTED", "AWAITING_PAYMENT", "IN_PROGRESS", "COMPLETED", "CANCELLED"]), quoteRial: z.number().int().positive().optional(), expertId: z.string().min(1).optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "وضعیت یا مبلغ معتبر نیست." });
  const current = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: "درخواست پیدا نشد." });
  if (req.user.role === "EXPERT" && current.expertId !== req.user.id) return res.status(403).json({ error: "این پرونده به شما تخصیص داده نشده است." });
  const allowedNext = {
    REQUESTED: ["UNDER_REVIEW", "CANCELLED"],
    UNDER_REVIEW: ["QUOTED", "IN_PROGRESS", "CANCELLED"],
    QUOTED: ["AWAITING_PAYMENT", "CANCELLED"],
    AWAITING_PAYMENT: ["IN_PROGRESS", "CANCELLED"],
    IN_PROGRESS: ["COMPLETED", "CANCELLED"],
    COMPLETED: [],
    CANCELLED: []
  };
  if (!allowedNext[current.status]?.includes(parsed.data.status) && current.status !== parsed.data.status) {
    return res.status(409).json({ error: "تغییر وضعیت انتخاب‌شده با وضعیت فعلی سازگار نیست." });
  }
  const data = { status: parsed.data.status };
  if (parsed.data.quoteRial !== undefined) data.quoteRial = BigInt(parsed.data.quoteRial);
  if (parsed.data.status === "QUOTED" && parsed.data.quoteRial === undefined && current.quoteRial == null) {
    return res.status(400).json({ error: "برای اعلام هزینه، مبلغ پیشنهادی را وارد کنید." });
  }
  if (parsed.data.expertId !== undefined) {
    if (req.user.role !== "ADMIN") return res.status(403).json({ error: "فقط مدیر می‌تواند پرونده را تخصیص دهد." });
    const expert = await prisma.user.findUnique({ where: { id: parsed.data.expertId }, select: { id: true, role: true, active: true } });
    if (!expert || expert.role !== "EXPERT" || !expert.active) return res.status(400).json({ error: "کارشناس معتبر و فعالی انتخاب نشده است." });
    data.expertId = expert.id;
  }
  const order = await prisma.order.update({ where: { id: current.id }, data });
  await prisma.auditEvent.create({ data: { actorId: req.user.id, orderId: order.id, action: "order.status_changed", metadata: { status: order.status } } });
  res.json({ order: jsonSafe(order) });
}));

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err && err.code === "P2002") return res.status(409).json({ error: "این اطلاعات قبلاً ثبت شده است." });
  res.status(500).json({ error: "خطای داخلی رخ داد." });
});
const server = app.listen(port, () => console.log(`Hami Kar API listening on ${port}`));
async function shutdown() { server.close(); await prisma.$disconnect(); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
