'use strict';

const { Contract } = require('fabric-contract-api');

class ChatContract extends Contract {

    async initLedger(ctx) {
        console.info('Chat Ledger Initialized');
    }

    async CreateMessage(ctx, roomId, userId, content) {
        const txTimestamp = ctx.stub.getTxTimestamp();
        const timestamp = new Date(txTimestamp.seconds.low * 1000).toISOString();

        const message = {
            docType: 'message',
            roomId: roomId,
            userId: userId,
            content: content,
            timestamp: timestamp
        };

        const compositeKey = ctx.stub.createCompositeKey('MSG', [roomId, timestamp]);

        await ctx.stub.putState(compositeKey, Buffer.from(JSON.stringify(message)));
        return JSON.stringify(message);
    }

    async GetChatHistory(ctx, roomId) {
        const allResults = [];
        const iteratorPromise = ctx.stub.getStateByPartialCompositeKey('MSG', [roomId]);
        let result = await iteratorPromise;
        
        while (true) {
            const res = await result.next();
            if (res.value && res.value.value.toString()) {
                const Record = JSON.parse(res.value.value.toString('utf8'));
                allResults.push(Record);
            }
            if (res.done) {
                await result.close();
                break;
            }
        }
        return JSON.stringify(allResults);
    }
}

module.exports = ChatContract;