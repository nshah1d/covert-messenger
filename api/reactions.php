<?php
/**
 * POST /api/reactions.php: toggles the caller's reaction on a message.
 *
 * Body: {message_id, emoji}. Sending the same emoji again removes it. Only the
 * six emoji the interface offers are accepted, and only on messages that are not
 * deleted. Responds with the action taken and the updated message.
 */

require_once __DIR__ . '/../includes/auth_check.php';
$identity = validateToken();

require_once __DIR__ . '/../includes/chat.php';

const REACTION_EMOJI = ['👍', '❤️', '🔥', '😂', '😮', '😢'];

runApi(function () use ($identity) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        header('Allow: POST');
        failWith(405, 'method_not_allowed');
    }

    $input = readJsonBody();
    $messageId = positiveId($input['message_id'] ?? null);
    $emoji = $input['emoji'] ?? null;
    if ($messageId === null || !is_string($emoji) || !in_array($emoji, REACTION_EMOJI, true)) {
        failWith(400, 'invalid_reaction');
    }

    $db = getDB();
    $action = withFeedLock($db, function (PDO $db) use ($identity, $messageId, $emoji) {
        $msg = $db->prepare('SELECT is_deleted FROM messages WHERE id = ? FOR UPDATE');
        $msg->execute([$messageId]);
        $deleted = $msg->fetchColumn();
        if ($deleted === false || (int)$deleted === 1) failWith(404, 'not_found');

        $existing = $db->prepare('SELECT id FROM message_reactions WHERE message_id = ? AND sender_identity = ? AND emoji = ?');
        $existing->execute([$messageId, $identity, $emoji]);
        $reactionId = $existing->fetchColumn();
        if ($reactionId !== false) {
            $db->prepare('DELETE FROM message_reactions WHERE id = ?')->execute([$reactionId]);
            $action = 'removed';
        } else {
            $db->prepare('INSERT INTO message_reactions (message_id, sender_identity, emoji) VALUES (?, ?, ?)')
               ->execute([$messageId, $identity, $emoji]);
            $action = 'added';
        }
        return ['changed' => [$messageId], 'value' => $action];
    });

    respond(200, ['action' => $action, 'message' => loadMessagesById($db, [$messageId])[0]]);
});
