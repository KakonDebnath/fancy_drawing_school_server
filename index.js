const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 5000;
const jwt = require('jsonwebtoken');
require('dotenv').config()
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

// middleware
const corsOptions = {
    origin: '*',
    credentials: true,
    optionSuccessStatus: 200,
}
app.use(cors(corsOptions))
app.use(express.json())


const verifyJWT = (req, res, next) => {
    //TODO FIX ERROR MSG
    const authorization = req.headers.authorization
    if (!authorization) {
        return res.status(401).send({ error: true, message: ' token nai unauthorized access' })
    }
    // bearer token
    const token = authorization.split(' ')[1]

    jwt.verify(token, process.env.ACCESS_TOKEN, (err, decoded) => {
        if (err) {
            return res
                .status(401)
                .send({ error: true, message: "didn't match unauthorized access" })
        }
        req.decoded = decoded
        next()
    })
}


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.v9m7cjb.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

app.get('/', (req, res) => {
    res.send('Welcome to summer school!');
});
async function run() {
    try {
        // all collections
        const usersCollection = client.db("summerSchoolDB").collection("users");
        const classesCollection = client.db("summerSchoolDB").collection("classes");
        const selectedClassesCollection = client.db("summerSchoolDB").collection("selectedClasses");
        const paymentsCollection = client.db("summerSchoolDB").collection("payments");
        // Connect the client to the server	(optional starting in v4.7)
        client.connect();

        // create payment intent
        app.post('/create-payment-intent', async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            });

            res.send({
                clientSecret: paymentIntent.client_secret
            })
        })

        // sign jwt
        app.post('/jwt', (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN, { expiresIn: '1h' })
            res.send({ token })
        })
        // TODO Change massage text

        // Verify Admin
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            if (user?.role !== 'admin') {
                return res.status(403).send({ error: true, message: "Forbidden User admin" })
            }
            next();
        }
        // Verify Instructor
        const verifyInstructor = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            if (user?.role !== 'instructor') {
                return res.status(403).send({ error: true, message: "Forbidden User Instructor" })
            }
            next();
        }


        // get all users for admin
        app.get("/users", verifyJWT, verifyAdmin, async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
        })
        // Save user email and role in DB all
        app.put('/users', async (req, res) => {
            const user = req.body
            const email = user.email
            const query = { email: email }
            const options = { upsert: true }
            const updateDoc = {
                $set: user,
            }
            const result = await usersCollection.updateOne(query, updateDoc, options)
            res.send(result)
        })

        // check role for users all
        app.get("/users/role/:email", async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            let role = "";
            if (user) {
                if (user.role === "admin") {
                    role = "admin";
                } else if (user.role === "instructor") {
                    role = "instructor";
                } else if (user.role === "student") {
                    role = "student";
                }
            }
            res.send({ role: role });
        });


        // Get selected class for student
        app.get("/selectedClass", verifyJWT, async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const result = await selectedClassesCollection.find(query).toArray();
            res.send(result);
        })
        // Delete from selected class student
        app.delete("/selectedClass/:id", verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await selectedClassesCollection.deleteOne(query);
            res.send(result);
        })
        // Delete from selected class after payment has been confirmed student
        app.delete('/payment/selectedClass', verifyJWT, async (req, res) => {
            const { email, selectedId } = req.query;
            const query = { email: email, selectedClassId: selectedId }
            const result = await selectedClassesCollection.deleteOne(query);
            if(result.deletedCount > 0){
                const updateResult = await classesCollection.updateOne(
                    { _id: new ObjectId(selectedId) },
                    { $inc: { availableSeats: -1 , totalEnrolledStudent: 1} }
                )
                res.send(updateResult);
            }
        })
        // post selected class student
        app.post("/selectedClass", verifyJWT, async (req, res) => {
            const selectedClass = req.body
            const query = {
                email: selectedClass.email,
                selectedClassId: selectedClass.selectedClassId
            }
            const existing = await selectedClassesCollection.findOne(query)
            if (existing) {
                return res.send({ message: "This Class already exists" })
            }
            const result = await selectedClassesCollection.insertOne(selectedClass);
            res.send(result);
        })
        // get Payments stuent
        app.get("/payments", verifyJWT, async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const sort = { date: -1 };
            const result = await paymentsCollection.find(query).sort(sort).toArray();
            res.send(result);
        })
        // post Payment student
        app.post("/payments", verifyJWT, async (req, res) => {
            const payment = req.body;
            const result = await paymentsCollection.insertOne(payment);
            res.send(result);
        })

        // get all approved class for all students
        app.get("/allClasses", async (req, res) => {
            const result = await classesCollection.find({ status: "approved" }).toArray();
            res.send(result);
        })
        // get all Popular class for all students
        app.get("/popularClasses", async (req, res) => {
            const result = await classesCollection.find({ status: "approved" }).sort({ totalEnrolledStudent: -1 }).limit(6).toArray();
            res.send(result);
        });

        // get all instructor for all students
        app.get("/allInstructors", async (req, res) => {
            const result = await usersCollection.find({ role: "instructor" }).toArray();
            res.send(result);
        })



        // get all classes by user email for instructor
        app.get("/instructor/classes", verifyJWT, verifyInstructor, async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const result = await classesCollection.find(query).toArray();
            res.send(result);
        })

        // get all classes by user  for Admin
        app.get("/admin/classes", verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.query.email;
            const result = await classesCollection.find().toArray();
            res.send(result);
        })
        // Update admin feedback clicked by send feedback admin
        app.patch("/admin/feedback/:id", verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const adminFeedback = req.body.feedback;
            const filter = { _id: new ObjectId(id) };
            const options = { upsert: true };
            const updateDoc = {
                $set: {
                    adminFeedback: adminFeedback
                },
            };
            const result = await classesCollection.updateOne(filter, updateDoc, options);
            res.send(result);
        })
        // Update Collection Status clicked by approved adn deny btn admin
        app.patch("/admin/classes/:id", verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const status = req.body.status;
            const filter = { _id: new ObjectId(id) };
            const options = { upsert: true };
            const updateDoc = {
                $set: {
                    status: status,
                },
            };
            const result = await classesCollection.updateOne(filter, updateDoc, options);
            res.send(result);
        })
        // Make Admin by admin btn click
        app.patch("/admin/role/:email", verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const role = req.body.role;
            const filter = { email: email };
            const options = { upsert: true };
            const updateDoc = {
                $set: {
                    role: role,
                },
            };
            const result = await usersCollection.updateOne(filter, updateDoc, options);
            res.send(result);
        })

        // Add A Class instructor
        app.post("/addClass", verifyJWT, verifyInstructor, async (req, res) => {
            const classes = req.body;
            // console.log(classes);
            const result = await classesCollection.insertOne(classes)
            res.send(result);
        })
        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);





app.listen(port, (req, res) => {
    console.log(`app is listening on port ${port}`);
});

